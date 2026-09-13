package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"otorem/internal/domain"
)

// Kontrak SPA: GET kontak selalu membawa array occasions; `null` membuat
// `c.occasions.map/length` di halaman kontak melempar TypeError.
func TestContactJSONOccasionsEmpty(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, err := s.CreateContact(ctx, u.ID, "Tanpa Occasion", "", "")
	if err != nil {
		t.Fatal(err)
	}

	// Detail kontak tanpa occasion.
	gw, err := s.GetContact(ctx, u.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	detail, _ := json.Marshal(gw)
	if got := string(detail); !strings.Contains(got, `"occasions":[]`) || strings.Contains(got, `"occasions":null`) {
		t.Errorf("detail kontak tanpa occasion harus \"occasions\":[], dapat %s", got)
	}

	// List memuat kontak yang sama (lewat fill()).
	list, err := s.ListContacts(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	lb, _ := json.Marshal(list)
	if got := string(lb); !strings.Contains(got, `"occasions":[]`) || strings.Contains(got, `"occasions":null`) {
		t.Errorf("list kontak tanpa occasion harus \"occasions\":[], dapat %s", got)
	}

	// User tanpa kontak: daftar tetap array kosong, bukan null.
	v, _ := s.GetOrCreateUser(ctx, "kosong@x.id", "Kosong", nil)
	empty, err := s.ListContacts(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	eb, _ := json.Marshal(empty)
	if string(eb) != "[]" {
		t.Errorf("list kontak kosong harus [], dapat %s", eb)
	}
}

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

func TestDeleteOccasionOwnerScope(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	a, _ := s.GetOrCreateUser(ctx, "a@x.id", "A", nil)
	b, _ := s.GetOrCreateUser(ctx, "b@x.id", "B", nil)
	ca, _ := s.CreateContact(ctx, a.ID, "Kontak A", "", "")
	cb, _ := s.CreateContact(ctx, b.ID, "Kontak B", "", "")
	oa, err := s.AddOccasion(ctx, ca.ID, domain.Otonan, domain.NewDate(1990, 5, 12), "")
	if err != nil {
		t.Fatal(err)
	}
	ob, err := s.AddOccasion(ctx, cb.ID, domain.Otonan, domain.NewDate(1991, 6, 13), "")
	if err != nil {
		t.Fatal(err)
	}

	// owner A tidak bisa hapus occasion milik B (IDOR)
	if err := s.DeleteOccasion(ctx, a.ID, ob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("owner A hapus occasion B harus ErrNotFound, dapat %v", err)
	}
	// occasion B masih ada
	if _, err := s.GetContact(ctx, b.ID, cb.ID); err != nil {
		t.Fatalf("occasion B hilang: %v", err)
	}

	// owner B hapus occasion miliknya sendiri: boleh
	if err := s.DeleteOccasion(ctx, b.ID, ob.ID); err != nil {
		t.Fatalf("owner B hapus occasion sendiri gagal: %v", err)
	}
	// hapus dua kali → ErrNotFound
	if err := s.DeleteOccasion(ctx, b.ID, ob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("hapus occasion yang sudah terhapus harus ErrNotFound, dapat %v", err)
	}

	// admin (ownerID 0) bisa hapus occasion milik siapa pun
	if err := s.DeleteOccasion(ctx, 0, oa.ID); err != nil {
		t.Errorf("admin hapus occasion gagal: %v", err)
	}
}
