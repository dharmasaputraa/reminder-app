package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestGetOrCreateUser(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	// Note: the brief does not call Migrate(); the Task 2 store needs an explicit migration.
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	admins := map[string]bool{"budi@x.id": true}
	u1, err := s.GetOrCreateUser(ctx, "Budi@X.id", "Budi", admins)
	if err != nil {
		t.Fatal(err)
	}
	if u1.Role != "admin" {
		t.Errorf("role = %q, want admin", u1.Role)
	}
	u2, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi Other", admins) // same email → no dup
	if u2.ID != u1.ID {
		t.Errorf("duplicate user: %q vs %q", u1.ID, u2.ID)
	}
	if _, err := uuid.Parse(u1.ID); err != nil {
		t.Errorf("user id not a uuid: %v", u1.ID)
	}
	u3, _ := s.GetOrCreateUser(ctx, "citra@x.id", "Citra", admins)
	if u3.Role != "member" {
		t.Errorf("non-admin role = %q", u3.Role)
	}
	users, _ := s.ListUsers(ctx)
	if len(users) != 2 {
		t.Errorf("user count = %d, want 2", len(users))
	}
}
