package scheduler

import (
	"context"
	"strings"
	"testing"
	"time"

	"wimember/internal/calendarprov"
	"wimember/internal/domain"
	"wimember/internal/notify"
	"wimember/internal/store"
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

// seed: user@1, contact, otonan base = today-210 (occurrence EXACTLY on `today`),
// 1 gotify channel.
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
	if _, err := st.CreateChannel(ctx, u.ID, "gotify", "home", []byte("enc")); err != nil {
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

// today at 08:02 UTC → the D offset is sent; D-1..D-7 (the 4 other offsets) → missed.
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
	if strings.Contains(h.notif.sent[0].Body, "Sent late") {
		t.Error("must not be late")
	}

	// 2nd run → everything is deduped
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 || res.Missed != 0 {
		t.Errorf("dedupe failed: %+v", res)
	}
	// PRE-SEND dedupe: the stub must not be called again — the per-minute
	// scanner must not re-push the same reminder over and over.
	if len(h.notif.sent) != 1 {
		t.Errorf("stub called %d times after run 2, must stay 1 (double spam)", len(h.notif.sent))
	}
}

// at 07:00 → the D-1 offset (yesterday 08:00) is still in the window → sent late;
// D-2..D-7 → missed; D is not due yet.
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
	if !strings.Contains(h.notif.sent[0].Body, "Sent late") {
		t.Errorf("must be late: %q", h.notif.sent[0].Body)
	}
}

// send fails → not recorded → retried after the 15-minute backoff passes.
func TestRunOnceRetryAfterFailure(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.notif.err = context.DeadlineExceeded
	res, _ := h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 1 {
		t.Fatalf("failed = %d", res.Failed)
	}

	// 1 minute later: still in backoff → no attempt
	h.fc.Add(time.Minute)
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 0 || res.Sent != 0 {
		t.Errorf("backoff leaked: %+v", res)
	}

	// 16 minutes later + now successful → sent
	h.fc.Add(16 * time.Minute)
	h.notif.err = nil
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 1 {
		t.Errorf("retry failed: %+v", res)
	}
}

// targetChannels: the contact's own selection wins; without one, the system
// default channels apply; a default matching nothing enabled falls back to
// every enabled channel.
//
// OpenInMemory shares one in-memory DB across the package's tests (dedupe is
// what keeps re-runs quiet), so this test brings its own user, contact and
// channels instead of relying on seed()'s state.
func TestTargetChannelsSystemDefault(t *testing.T) {
	h := newHarness(t, time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC))
	ctx := context.Background()
	u, err := h.st.GetOrCreateUser(ctx, "target-channels@x.id", "Tc", nil)
	if err != nil {
		t.Fatal(err)
	}
	chA, err := h.st.CreateChannel(ctx, u.ID, "gotify", "a", []byte("enc"))
	if err != nil {
		t.Fatal(err)
	}
	chB, err := h.st.CreateChannel(ctx, u.ID, "telegram", "b", []byte("enc"))
	if err != nil {
		t.Fatal(err)
	}
	c, err := h.st.CreateContact(ctx, u.ID, "Made", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.st.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(2026, 6, 17), ""); err != nil {
		t.Fatal(err)
	}

	cw := func(t *testing.T) store.ContactWithOccasions {
		t.Helper()
		got, err := h.st.GetContact(ctx, u.ID, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		return *got
	}
	same := func(got []store.Channel, want ...int64) bool {
		if len(got) != len(want) {
			return false
		}
		set := map[int64]bool{}
		for _, ch := range got {
			set[ch.ID] = true
		}
		for _, id := range want {
			if !set[id] {
				return false
			}
		}
		return true
	}

	// no default configured → every enabled channel
	if got := h.svc.targetChannels(ctx, cw(t), nil); !same(got, chA.ID, chB.ID) {
		t.Errorf("no default: got %v", got)
	}
	// system default → just that channel
	if got := h.svc.targetChannels(ctx, cw(t), []int64{chB.ID}); !same(got, chB.ID) {
		t.Errorf("default [B]: got %v", got)
	}
	// default matching nothing enabled → falls back to every enabled channel
	if got := h.svc.targetChannels(ctx, cw(t), []int64{999}); !same(got, chA.ID, chB.ID) {
		t.Errorf("unknown default: got %v", got)
	}

	// the contact's own selection beats the system default
	if err := h.st.SetReminderPrefs(ctx, store.ReminderPrefs{
		ContactID: c.ID, ChannelIDs: []int64{chA.ID}, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if got := h.svc.targetChannels(ctx, cw(t), []int64{chB.ID}); !same(got, chA.ID) {
		t.Errorf("explicit selection: got %v", got)
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
		t.Fatalf("sent = %d, want 2 (otonan + Galungan)", res.Sent)
	}
	found := false
	for _, m := range h.notif.sent {
		if strings.Contains(m.Title, "Galungan") {
			found = true
		}
	}
	if !found {
		t.Error("Galungan message not sent")
	}
	// dedupe holiday
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 {
		t.Errorf("holiday dedupe failed: %+v", res)
	}
	// PRE-SEND dedupe: total stub calls stay 2 (otonan + Galungan).
	if len(h.notif.sent) != 2 {
		t.Errorf("stub called %d times after run 2, must stay 2 (double spam)", len(h.notif.sent))
	}
}

// Service is built exactly like in main.go (Plan 3 Task 9): struct literal
// from outside the package — the unexported failUntil field cannot be initialized,
// so lazy-init in RunOnce is mandatory; the first failed send must not panic
// on the nil map and kill the scan loop.
func TestRunOnceExternalLiteralNoPanicOnFail(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	st, err := store.OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	seed(t, st, domain.DateFromTime(now))
	n := &stubNotifier{err: context.DeadlineExceeded}
	svc := &Service{St: st, Clock: &FakeClock{T: now}, // NO failUntil — nil map
		Providers: []calendarprov.Provider{&stubProvider{}},
		Resolve:   func(_ context.Context, ch store.Channel) (notify.Notifier, error) { return n, nil }}

	res, err := svc.RunOnce(context.Background(), snapUTC())
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 1 {
		t.Fatalf("failed = %d", res.Failed)
	}

	// 1 minute later: still in backoff → no attempt
	svc.Clock.(*FakeClock).Add(time.Minute)
	res, _ = svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 0 || res.Sent != 0 {
		t.Errorf("backoff leaked: %+v", res)
	}

	// 16 minutes later + success → sent
	svc.Clock.(*FakeClock).Add(16 * time.Minute)
	n.err = nil
	res, _ = svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 1 {
		t.Errorf("retry failed: %+v", res)
	}
}

func TestHolidayKey(t *testing.T) {
	got := HolidayKey("pawukon", domain.Holiday{Name: "Batu Kuning"})
	if got != "pawukon:batu-kuning" {
		t.Errorf("key = %q", got)
	}
}
