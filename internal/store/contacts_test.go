package store

import (
	"context"
	"testing"

	"otorem/internal/domain"
)

func seedContact(t *testing.T, s *Store) (User, ContactWithOccasions) {
	t.Helper()
	ctx := context.Background()
	// Catatan: brief tidak memanggil Migrate(); store hasil Task 2 butuh migrasi eksplisit.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, err := s.CreateContact(ctx, u.ID, "Made Wijaya", "Made", "sepupu")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(1990, 5, 12), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddOccasion(ctx, c.ID, domain.Birthday, domain.NewDate(1990, 5, 20), ""); err != nil {
		t.Fatal(err)
	}
	if err := s.SetReminderPrefs(ctx, ReminderPrefs{ContactID: c.ID, Offsets: []int{1, 0}, ChannelIDs: []int64{}, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	cw, err := s.GetContact(ctx, u.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	return u, *cw
}

func TestContactCRUD(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	u, cw := seedContact(t, s)
	if len(cw.Occasions) != 2 {
		t.Fatalf("occasions = %d", len(cw.Occasions))
	}
	if cw.Prefs == nil || len(cw.Prefs.Offsets) != 2 {
		t.Fatalf("prefs salah: %+v", cw.Prefs)
	}
	if cw.Nickname != "Made" {
		t.Errorf("nickname = %q", cw.Nickname)
	}

	if err := s.UpdateContact(context.Background(), u.ID, cw.ID, "Made W.", "", "catatan baru"); err != nil {
		t.Fatal(err)
	}
	ls, _ := s.ListContacts(context.Background(), u.ID)
	if ls[0].Name != "Made W." {
		t.Errorf("update gagal: %q", ls[0].Name)
	}

	// owner lain tidak bisa lihat
	v, _ := s.GetOrCreateUser(context.Background(), "lain@x.id", "Lain", nil)
	if _, err := s.GetContact(context.Background(), v.ID, cw.ID); err == nil {
		t.Error("akses kontak user lain harus error")
	}
	// admin (ownerID 0) bisa
	if _, err := s.GetContact(context.Background(), 0, cw.ID); err != nil {
		t.Errorf("admin harus bisa akses: %v", err)
	}

	if err := s.DeleteContact(context.Background(), u.ID, cw.ID); err != nil {
		t.Fatal(err)
	}
	ls, _ = s.ListContacts(context.Background(), u.ID)
	if len(ls) != 0 {
		t.Errorf("delete gagal: %d tersisa", len(ls))
	}
}

func TestAddOccasionValidatesType(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Catatan: brief tidak memanggil Migrate(); store hasil Task 2 butuh migrasi eksplisit.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetOrCreateUser(context.Background(), "budi@x.id", "Budi", nil)
	c, _ := s.CreateContact(context.Background(), u.ID, "X", "", "")
	if _, err := s.AddOccasion(context.Background(), c.ID, "salfok", domain.NewDate(2000, 1, 1), ""); err == nil {
		t.Error("tipe ilegal harus ditolak")
	}
}
