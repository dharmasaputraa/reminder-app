package store

import (
	"context"
	"testing"

	"otorem/internal/domain"
)

func TestRecordNotificationDedupe(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Catatan: brief tidak memanggil Migrate(); store hasil Task 2 butuh migrasi eksplisit.
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

func TestHolidayDedupeIndependent(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Catatan: brief tidak memanggil Migrate(); store hasil Task 2 butuh migrasi eksplisit.
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
	// Catatan: brief tidak memanggil Migrate(); store hasil Task 2 butuh migrasi eksplisit.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	ch, _ := s.CreateChannel(ctx, u.ID, "email", "cadangan", []byte("enc"))

	// OccasionID dan HolidayKey keduanya nil: tidak dicakup kedua partial unique
	// index (WHERE ... IS NOT NULL) — wajib ditolak agar dedupe tidak bocor.
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
	// Catatan: brief tidak memanggil Migrate(); store hasil Task 2 butuh migrasi eksplisit.
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
