package scheduler

import (
	"context"
	"strings"
	"testing"
	"time"

	"otorem/internal/calendarprov"
	"otorem/internal/domain"
	"otorem/internal/notify"
	"otorem/internal/store"
)

type stubNotifier struct {
	sent []notify.Message
	err  error
}

func (s *stubNotifier) Name() string { return "stub" }
func (s *stubNotifier) Send(_ context.Context, m notify.Message) error {
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, m)
	return nil
}
func (s *stubNotifier) Test(_ context.Context) error { return nil }

type stubProvider struct{ hs []domain.Holiday }

func (s *stubProvider) Name() string     { return "stub" }
func (s *stubProvider) Category() string { return "pawukon" }
func (s *stubProvider) HolidaysBetween(_ context.Context, _, _ domain.Date) ([]domain.Holiday, error) {
	return s.hs, nil
}

func snapUTC() Snapshot {
	return Snapshot{Timezone: "UTC", SendTime: "08:00", CatchUpHours: 24,
		DefaultOffsets:    domain.DefaultOffsets,
		HolidayCategories: map[string]bool{"pawukon": true, "saka": true, "national": true}}
}

// seed: user@1, contact, otonan base = today-210 (occurrence TEPAT di `today`),
// 1 channel gotify.
func seed(t *testing.T, st *store.Store, today domain.Date) {
	t.Helper()
	ctx := context.Background()
	u, err := st.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	if err != nil {
		t.Fatal(err)
	}
	c, err := st.CreateContact(ctx, u.ID, "Made", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.AddOccasion(ctx, c.ID, domain.Otonan, today.AddDays(-domain.PawukonCycleDays), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateChannel(ctx, u.ID, "gotify", "rumah", []byte("enc")); err != nil {
		t.Fatal(err)
	}
}

type harness struct {
	st    *store.Store
	fc    *FakeClock
	notif *stubNotifier
	svc   *Service
}

func newHarness(t *testing.T, now time.Time) *harness {
	t.Helper()
	st, err := store.OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	fc := &FakeClock{T: now}
	seed(t, st, domain.DateFromTime(now))
	n := &stubNotifier{}
	svc := &Service{St: st, Clock: fc, Providers: []calendarprov.Provider{&stubProvider{}},
		Resolve:   func(_ context.Context, ch store.Channel) (notify.Notifier, error) { return n, nil },
		failUntil: map[int64]time.Time{}}
	return &harness{st: st, fc: fc, notif: n, svc: svc}
}

// hari ini pukul 08:02 UTC → offset H dikirim; H-1..H-7 (4 offset lain) → missed.
func TestRunOnceOnTime(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil {
		t.Fatal(err)
	}
	if res.Sent != 1 || res.Failed != 0 || res.Missed != 4 {
		t.Fatalf("res = %+v, want Sent1 Missed4", res)
	}
	if len(h.notif.sent) != 1 {
		t.Fatalf("notif = %d", len(h.notif.sent))
	}
	if strings.Contains(h.notif.sent[0].Body, "terlambat") {
		t.Error("tidak boleh late")
	}

	// run ke-2 → semua ter-dedupe
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 || res.Missed != 0 {
		t.Errorf("dedupe gagal: %+v", res)
	}
	// dedupe PRE-SEND: stub tidak boleh terpanggil ulang — scanner tiap
	// menit tidak boleh meng-push reminder yang sama berulang kali.
	if len(h.notif.sent) != 1 {
		t.Errorf("stub terpanggil %d kali setelah run ke-2, harus tetap 1 (spam dobel)", len(h.notif.sent))
	}
}

// pukul 07:00 → offset H-1 (kemarin 08:00) masih dalam window → kirim late;
// H-2..H-7 → missed; H belum due.
func TestRunOnceCatchUpLate(t *testing.T) {
	now := time.Date(2026, 6, 17, 7, 0, 0, 0, time.UTC)
	h := newHarness(t, now)
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil {
		t.Fatal(err)
	}
	if res.Sent != 1 || res.Missed != 3 {
		t.Fatalf("res = %+v, want Sent1 Missed3", res)
	}
	if !strings.Contains(h.notif.sent[0].Body, "terlambat") {
		t.Errorf("harus late: %q", h.notif.sent[0].Body)
	}
}

// send gagal → tidak recorded → retry setelah backoff 15 menit lewat.
func TestRunOnceRetryAfterFailure(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.notif.err = context.DeadlineExceeded
	res, _ := h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 1 {
		t.Fatalf("failed = %d", res.Failed)
	}

	// 1 menit kemudian: masih dalam backoff → tidak ada attempt
	h.fc.Add(time.Minute)
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 0 || res.Sent != 0 {
		t.Errorf("backoff bocor: %+v", res)
	}

	// 16 menit kemudian + sudah sukses → sent
	h.fc.Add(16 * time.Minute)
	h.notif.err = nil
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 1 {
		t.Errorf("retry gagal: %+v", res)
	}
}

func TestHolidayReminder(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.svc.Providers = []calendarprov.Provider{
		&stubProvider{hs: []domain.Holiday{{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}}}}
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil {
		t.Fatal(err)
	}
	if res.Sent != 2 {
		t.Fatalf("sent = %d, want 2 (otoman + galungan)", res.Sent)
	}
	found := false
	for _, m := range h.notif.sent {
		if strings.Contains(m.Title, "Galungan") {
			found = true
		}
	}
	if !found {
		t.Error("pesan galungan tidak terkirim")
	}
	// dedupe holiday
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 {
		t.Errorf("holiday dedupe gagal: %+v", res)
	}
	// dedupe PRE-SEND: total panggilan stub tetap 2 (otonan + galungan).
	if len(h.notif.sent) != 2 {
		t.Errorf("stub terpanggil %d kali setelah run ke-2, harus tetap 2 (spam dobel)", len(h.notif.sent))
	}
}

func TestHolidayKey(t *testing.T) {
	got := HolidayKey("pawukon", domain.Holiday{Name: "Batu Kuning"})
	if got != "pawukon:batu-kuning" {
		t.Errorf("key = %q", got)
	}
}
