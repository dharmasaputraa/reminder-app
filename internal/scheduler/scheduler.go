// Package scheduler: scan-based reminder engine. Stateless terhadap DB —
// keputusan kirim/missed dihitung tiap scan dari (now, settings, contacts,
// notification_log). Idempotent: aman crash/restart.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"otorem/internal/calendarprov"
	"otorem/internal/domain"
	"otorem/internal/notify"
	"otorem/internal/store"
)

type Clock interface{ Now() time.Time }

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

type FakeClock struct{ T time.Time }

func (f *FakeClock) Now() time.Time      { return f.T }
func (f *FakeClock) Add(d time.Duration) { f.T = f.T.Add(d) }

type Snapshot struct {
	Timezone          string
	SendTime          string
	CatchUpHours      int
	DefaultOffsets    []int
	HolidayCategories map[string]bool
}

type Resolver func(ctx context.Context, ch store.Channel) (notify.Notifier, error)

type Result struct{ Sent, Failed, Missed int }

const failBackoff = 15 * time.Minute

var notifCounter = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "otorem_notifications_total",
	Help: "notifikasi per status dan kind",
}, []string{"status", "kind"})

type Service struct {
	St        *store.Store
	Clock     Clock
	Providers []calendarprov.Provider
	Resolve   Resolver

	mu        sync.Mutex
	failUntil map[int64]time.Time
}

func HolidayKey(category string, h domain.Holiday) string {
	return category + ":" + strings.ToLower(strings.ReplaceAll(h.Name, " ", "-"))
}

func parseSendTime(s string) (int, int, error) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, 0, fmt.Errorf("send_time invalid: %q", s)
	}
	return t.Hour(), t.Minute(), nil
}

func maxOffset(offsets []int) int {
	m := 0
	for _, o := range offsets {
		if o > m {
			m = o
		}
	}
	return m
}

// targetChannels: channel tujuan satu kontak.
func (s *Service) targetChannels(ctx context.Context, cw store.ContactWithOccasions) []store.Channel {
	all, err := s.St.ListChannels(ctx, cw.OwnerID)
	if err != nil {
		return nil
	}
	enabled := all[:0:0]
	for _, ch := range all {
		if ch.Enabled {
			enabled = append(enabled, ch)
		}
	}
	if cw.Prefs != nil && len(cw.Prefs.ChannelIDs) > 0 {
		want := map[int64]bool{}
		for _, id := range cw.Prefs.ChannelIDs {
			want[id] = true
		}
		filtered := enabled[:0:0]
		for _, ch := range enabled {
			if want[ch.ID] {
				filtered = append(filtered, ch)
			}
		}
		return filtered
	}
	return enabled
}

func (s *Service) RunOnce(ctx context.Context, snap Snapshot) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var res Result

	loc, err := time.LoadLocation(snap.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := s.Clock.Now().In(loc)
	sendHH, sendMM, err := parseSendTime(snap.SendTime)
	if err != nil {
		return res, err
	}
	// Window catch-up dihitung dari now: reminder yang jatuhnya ≤ CatchUpHours
	// lalu masih boleh dikirim (catch-up); lebih tua dari itu → missed. Dasar
	// waktu `now` (bukan today@SendTime) dibutuhkan konsistensi test anchor:
	// di 08:02 dengan CatchUp 24 jam, H-1 (kemarin 08:00 = 24j2m lalu) sudah
	// di luar window → missed; di 07:00 (23 jam lalu) masih masuk → kirim late.
	dueStart := now.Add(-time.Duration(snap.CatchUpHours) * time.Hour)
	today := domain.DateFromTime(now)

	maxOff := maxOffset(snap.DefaultOffsets)
	catchUpDays := (snap.CatchUpHours + 23) / 24
	lookback := maxOff + catchUpDays + 2
	from := today.AddDays(-lookback)
	to := today.AddDays(maxOff + 2)

	// ---- occasions ----
	contacts, err := s.St.ListContacts(ctx, 0) // admin scope: semua kontak
	if err != nil {
		return res, err
	}
	for _, cw := range contacts {
		if cw.Prefs != nil && !cw.Prefs.Enabled {
			continue
		}
		offsets := snap.DefaultOffsets
		if cw.Prefs != nil && len(cw.Prefs.Offsets) > 0 {
			offsets = cw.Prefs.Offsets
		}
		channels := s.targetChannels(ctx, cw)
		oOff := maxOffset(offsets)
		fromO := today.AddDays(-(oOff + catchUpDays + 2))
		toO := today.AddDays(oOff + 2)
		for _, occ := range cw.Occasions {
			occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, fromO, toO)
			if err != nil {
				continue
			}
			for _, o := range occs {
				for _, off := range offsets {
					rDate := o.Date.AddDays(-off)
					sendAt := time.Date(rDate.Year, time.Month(rDate.Month), rDate.Day, sendHH, sendMM, 0, 0, loc)
					if sendAt.After(now) {
						continue
					}
					occID := occ.ID
					entry := store.NotificationEntry{OccasionID: &occID,
						OccurrenceDate: o.Date, OffsetDays: off}
					if sendAt.Before(dueStart) {
						for _, ch := range channels {
							entry.ChannelID, entry.Status = ch.ID, "missed"
							s.record(ctx, entry, &res, "occasion")
						}
						continue
					}
					late := now.Sub(sendAt) > time.Hour
					msg := notify.OccurrenceMessage(cw.Name, o, o.Date.JDN()-today.JDN(), late)
					s.deliver(ctx, channels, entry, msg, &res, "occasion")
				}
			}
		}
	}

	// ---- holidays ----
	for _, p := range s.Providers {
		if !snap.HolidayCategories[p.Category()] {
			continue
		}
		hs, err := p.HolidaysBetween(ctx, from, to)
		if err != nil {
			// provider remote gagal → lewati; pawukon computed tetap jalan
			continue
		}
		for _, h := range hs {
			hkey := HolidayKey(p.Category(), h)
			for _, off := range snap.DefaultOffsets {
				rDate := h.Date.AddDays(-off)
				sendAt := time.Date(rDate.Year, time.Month(rDate.Month), rDate.Day, sendHH, sendMM, 0, 0, loc)
				if sendAt.After(now) {
					continue
				}
				entry := store.NotificationEntry{HolidayKey: &hkey,
					OccurrenceDate: h.Date, OffsetDays: off}
				if sendAt.Before(dueStart) {
					// holiday → semua channel milik SEMUA user (broadcast)
					users, err := s.St.ListUsers(ctx)
					if err != nil {
						continue
					}
					for _, u := range users {
						chs, _ := s.St.ListChannels(ctx, u.ID)
						for _, ch := range chs {
							if ch.Enabled {
								entry.ChannelID, entry.Status = ch.ID, "missed"
								s.record(ctx, entry, &res, "holiday")
							}
						}
					}
					continue
				}
				late := now.Sub(sendAt) > time.Hour
				msg := notify.HolidayMessage(h, h.Date.JDN()-today.JDN(), late)
				users, err := s.St.ListUsers(ctx)
				if err != nil {
					continue
				}
				for _, u := range users {
					chs, _ := s.St.ListChannels(ctx, u.ID)
					var enabled []store.Channel
					for _, ch := range chs {
						if ch.Enabled {
							enabled = append(enabled, ch)
						}
					}
					s.deliver(ctx, enabled, entry, msg, &res, "holiday")
				}
			}
		}
	}
	return res, nil
}

func (s *Service) record(ctx context.Context, e store.NotificationEntry, res *Result, kind string) {
	inserted, err := s.St.RecordNotification(ctx, e)
	if err != nil || !inserted {
		return
	}
	res.Missed++
	notifCounter.WithLabelValues("missed", kind).Inc()
}

func (s *Service) deliver(ctx context.Context, channels []store.Channel,
	e store.NotificationEntry, msg notify.Message, res *Result, kind string) {
	now := s.Clock.Now()
	for _, ch := range channels {
		if until, ok := s.failUntil[ch.ID]; ok && now.Before(until) {
			continue // backoff
		}
		e.ChannelID = ch.ID
		// Dedupe PRE-SEND: baris dengan dedupe key sama sudah ada → jangan
		// kirim ulang. Tanpa ini scanner per-menit meng-push ulang reminder
		// yang sama sepanjang hari — INSERT OR IGNORE hanya menahan counter,
		// bukan push (log dedupe terjadi SETELAH n.Send).
		exists, err := s.St.HasNotification(ctx, e)
		if err != nil {
			// Fail open (disengaja): cek dedupe yang gagal tidak boleh
			// membungkam reminder — lebih baik berisiko dobel push daripada
			// reminder hilang. INSERT OR IGNORE di log tetap mencegah dobel
			// catatan/counter.
			slog.Warn("has_notification gagal, kirim saja (fail open)",
				"channel_id", ch.ID, "err", err)
		} else if exists {
			continue
		}
		n, err := s.Resolve(ctx, ch)
		if err != nil {
			res.Failed++
			notifCounter.WithLabelValues("resolve_error", kind).Inc()
			continue
		}
		if err := n.Send(ctx, msg); err != nil {
			res.Failed++ // TIDAK di-record → retry scan berikutnya
			s.failUntil[ch.ID] = now.Add(failBackoff)
			notifCounter.WithLabelValues("failed", kind).Inc()
			continue
		}
		e.Status = "sent"
		inserted, err := s.St.RecordNotification(ctx, e)
		if err != nil {
			continue
		}
		if inserted {
			res.Sent++
		}
		notifCounter.WithLabelValues("sent", kind).Inc()
	}
}
