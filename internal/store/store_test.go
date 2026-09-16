package store

import (
	"context"
	"testing"
)

func TestOpenInMemoryAndMigrate(t *testing.T) {
	s, err := OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// idempotent
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate (2nd time): %v", err)
	}
	if err := s.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

func TestForeignKeysActive(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	_ = s.Migrate()
	_, err := s.db.Exec(`INSERT INTO contacts (id, owner_id, name) VALUES
		('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000099', 'x')`)
	if err == nil {
		t.Error("FK off — contact without user must be rejected")
	}
}
