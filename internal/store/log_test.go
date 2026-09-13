package store

import (
	"context"
	"testing"

	"otorem/internal/domain"
)

func TestRecordNotificationDedupe(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, _ := s.CreateContact(ctx, u.ID, "Made", "", "")
	oc, _ := s.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(1990, 5, 12), "")
	ch, _ := s.CreateChannel(ctx, u.ID, "gotify", "rumah", []byte("enc"))
	occID := oc.ID
	e := NotificationEntry{OccasionID: &occID, OccurrenceDate: domain.NewDate(2026, 6, 17),
		OffsetDays: 7, ChannelID: ch.ID, Status: "sent"}

	inserted, err := s.RecordNotification(ctx, e)
	if err != nil || !inserted {
		t.Fatalf("pertama: inserted=%v err=%v", inserted, err)
	}
	inserted, err = s.RecordNotification(ctx, e)
	if err != nil {
		t.Fatal(err)
	}
	if inserted {
		t.Error("kirim dobel harus di-dedupe (inserted=false)")
	}
}

func TestHasNotification(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, _ := s.CreateContact(ctx, u.ID, "Made", "", "")
	oc, _ := s.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(1990, 5, 12), "")
	ch, _ := s.CreateChannel(ctx, u.ID, "gotify", "rumah", []byte("enc"))
	occID := oc.ID
	e := NotificationEntry{OccasionID: &occID, OccurrenceDate: domain.NewDate(2026, 6, 17),
		OffsetDays: 7, ChannelID: ch.ID, Status: "sent"}

	before, err := s.HasNotification(ctx, e)
	if err != nil {
		t.Fatal(err)
	}
	if before {
		t.Error("sebelum record harus false")
	}
	if _, err := s.RecordNotification(ctx, e); err != nil {
		t.Fatal(err)
	}
	after, err := s.HasNotification(ctx, e)
	if err != nil {
		t.Fatal(err)
	}
	if !after {
		t.Error("setelah record harus true")
	}

	// different channel → not a duplicate
	e2 := e
	e2.ChannelID = ch.ID + 999
	if got, err := s.HasNotification(ctx, e2); err != nil || got {
		t.Errorf("channel lain harus false: got=%v err=%v", got, err)
	}

	// holiday key variant: false before record, true after
	hk := "pawukon:galungan"
	he := NotificationEntry{HolidayKey: &hk, OccurrenceDate: domain.NewDate(2026, 6, 17),
		OffsetDays: 0, ChannelID: ch.ID, Status: "sent"}
	if got, err := s.HasNotification(ctx, he); err != nil || got {
		t.Errorf("holiday sebelum record harus false: got=%v err=%v", got, err)
	}
	if _, err := s.RecordNotification(ctx, he); err != nil {
		t.Fatal(err)
	}
	if got, err := s.HasNotification(ctx, he); err != nil || !got {
		t.Errorf("holiday setelah record harus true: got=%v err=%v", got, err)
	}

	// both keys nil → error, consistent with RecordNotification
	if _, err := s.HasNotification(ctx, NotificationEntry{
		OccurrenceDate: domain.NewDate(2026, 6, 17), OffsetDays: 1, ChannelID: ch.ID}); err == nil {
		t.Error("kedua key nil harus error")
	}
}

func TestHolidayDedupeIndependent(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	ch, _ := s.CreateChannel(ctx, u.ID, "telegram", "grup", []byte("enc"))
	hk := "pawukon:galungan"
	_, _ = s.RecordNotification(ctx, NotificationEntry{HolidayKey: &hk,
		OccurrenceDate: domain.NewDate(2026, 6, 17), OffsetDays: 7, ChannelID: ch.ID, Status: "sent"})
	inserted, err := s.RecordNotification(ctx, NotificationEntry{HolidayKey: &hk,
		OccurrenceDate: domain.NewDate(2026, 6, 17), OffsetDays: 7, ChannelID: ch.ID, Status: "missed"})
	if err != nil || inserted {
		t.Errorf("dedupe holiday gagal: inserted=%v err=%v", inserted, err)
	}
}

func TestRecordNotificationRequiresKey(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	ch, _ := s.CreateChannel(ctx, u.ID, "email", "cadangan", []byte("enc"))

	// OccasionID and HolidayKey are both nil: not covered by either partial unique
	// index (WHERE ... IS NOT NULL) — must be rejected so dedupe does not leak.
	inserted, err := s.RecordNotification(ctx, NotificationEntry{
		OccurrenceDate: domain.NewDate(2026, 6, 17), OffsetDays: 7, ChannelID: ch.ID, Status: "sent"})
	if err == nil {
		t.Fatal("OccasionID dan HolidayKey keduanya nil harus error")
	}
	if inserted {
		t.Error("entry tanpa key tidak boleh tercatat (inserted=false)")
	}
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("notification_log harus kosong, dapat %d baris", n)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var v map[string]any
	if err := s.GetSettingJSON(ctx, "tidak_ada", &v); err != ErrNotFound {
		t.Errorf("setting kosong harus ErrNotFound, dapat %v", err)
	}
	in := map[string]any{"timezone": "Asia/Makassar", "n": float64(2)}
	if err := s.PutSettingJSON(ctx, "tz", in); err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := s.GetSettingJSON(ctx, "tz", &out); err != nil {
		t.Fatal(err)
	}
	if out["timezone"] != "Asia/Makassar" {
		t.Errorf("got %v", out)
	}
}
