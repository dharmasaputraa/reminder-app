package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"otorem/internal/domain"
)

// SPA contract: GET contact always carries an occasions array; `null` makes
// `c.occasions.map/length` on the contact page throw a TypeError.
func TestContactJSONOccasionsEmpty(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, err := s.CreateContact(ctx, u.ID, "Without Occasion", "", "")
	if err != nil {
		t.Fatal(err)
	}

	// Contact detail without occasions.
	gw, err := s.GetContact(ctx, u.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	detail, _ := json.Marshal(gw)
	if got := string(detail); !strings.Contains(got, `"occasions":[]`) || strings.Contains(got, `"occasions":null`) {
		t.Errorf("contact detail without occasion must be \"occasions\":[], got %s", got)
	}

	// List contains the same contact (via fill()).
	list, err := s.ListContacts(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	lb, _ := json.Marshal(list)
	if got := string(lb); !strings.Contains(got, `"occasions":[]`) || strings.Contains(got, `"occasions":null`) {
		t.Errorf("contact list without occasion must be \"occasions\":[], got %s", got)
	}

	// User with no contacts: the list is still an empty array, not null.
	v, _ := s.GetOrCreateUser(ctx, "empty@x.id", "Empty", nil)
	empty, err := s.ListContacts(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	eb, _ := json.Marshal(empty)
	if string(eb) != "[]" {
		t.Errorf("empty contact list must be [], got %s", eb)
	}
}

func seedContact(t *testing.T, s *Store) (User, ContactWithOccasions) {
	t.Helper()
	ctx := context.Background()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, err := s.CreateContact(ctx, u.ID, "Made Wijaya", "Made", "cousin")
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
		t.Fatalf("wrong prefs: %+v", cw.Prefs)
	}
	if cw.Nickname != "Made" {
		t.Errorf("nickname = %q", cw.Nickname)
	}

	if err := s.UpdateContact(context.Background(), u.ID, cw.ID, "Made W.", "", "new note"); err != nil {
		t.Fatal(err)
	}
	ls, _ := s.ListContacts(context.Background(), u.ID)
	if ls[0].Name != "Made W." {
		t.Errorf("update failed: %q", ls[0].Name)
	}

	// another owner cannot see it
	v, _ := s.GetOrCreateUser(context.Background(), "other@x.id", "Other", nil)
	if _, err := s.GetContact(context.Background(), v.ID, cw.ID); err == nil {
		t.Error("accessing another user's contact must error")
	}
	// admin (ownerID 0) can
	if _, err := s.GetContact(context.Background(), 0, cw.ID); err != nil {
		t.Errorf("admin must be able to access: %v", err)
	}

	if err := s.DeleteContact(context.Background(), u.ID, cw.ID); err != nil {
		t.Fatal(err)
	}
	ls, _ = s.ListContacts(context.Background(), u.ID)
	if len(ls) != 0 {
		t.Errorf("delete failed: %d left", len(ls))
	}
}

func TestAddOccasionValidatesType(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetOrCreateUser(context.Background(), "budi@x.id", "Budi", nil)
	c, _ := s.CreateContact(context.Background(), u.ID, "X", "", "")
	if _, err := s.AddOccasion(context.Background(), c.ID, "bogus", domain.NewDate(2000, 1, 1), ""); err == nil {
		t.Error("illegal type must be rejected")
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
	ca, _ := s.CreateContact(ctx, a.ID, "Contact A", "", "")
	cb, _ := s.CreateContact(ctx, b.ID, "Contact B", "", "")
	oa, err := s.AddOccasion(ctx, ca.ID, domain.Otonan, domain.NewDate(1990, 5, 12), "")
	if err != nil {
		t.Fatal(err)
	}
	ob, err := s.AddOccasion(ctx, cb.ID, domain.Otonan, domain.NewDate(1991, 6, 13), "")
	if err != nil {
		t.Fatal(err)
	}

	// owner A cannot delete B's occasion (IDOR)
	if err := s.DeleteOccasion(ctx, a.ID, ob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("owner A deleting B's occasion must be ErrNotFound, got %v", err)
	}
	// B's occasion is still there
	if _, err := s.GetContact(ctx, b.ID, cb.ID); err != nil {
		t.Fatalf("B's occasion missing: %v", err)
	}

	// owner B deletes their own occasion: allowed
	if err := s.DeleteOccasion(ctx, b.ID, ob.ID); err != nil {
		t.Fatalf("owner B deleting own occasion failed: %v", err)
	}
	// deleting twice → ErrNotFound
	if err := s.DeleteOccasion(ctx, b.ID, ob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleting an already deleted occasion must be ErrNotFound, got %v", err)
	}

	// admin (ownerID 0) can delete anyone's occasion
	if err := s.DeleteOccasion(ctx, 0, oa.ID); err != nil {
		t.Errorf("admin deleting occasion failed: %v", err)
	}
}
