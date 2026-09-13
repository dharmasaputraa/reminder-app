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
		t.Fatalf("migrate ke-2: %v", err)
	}
	if err := s.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

func TestForeignKeysActive(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	_ = s.Migrate()
	_, err := s.db.Exec(`INSERT INTO contacts (owner_id, name) VALUES (999, 'x')`)
	if err == nil {
		t.Error("FK mati — contact tanpa user harus ditolak")
	}
}
