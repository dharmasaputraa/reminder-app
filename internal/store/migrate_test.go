package store

import (
	"context"
	"testing"

	"wimember/internal/domain"
)

// Regression: the occasion type "otongan" was renamed to "otonan" by editing
// 001_init.sql in place, but Migrate() never re-applies an already-run version.
// Databases created before the rename keep the old CHECK and reject the new
// spelling, which surfaced as a 500 on POST /contacts/:id/occasions.
func TestMigrate002RenamesOtonganType(t *testing.T) {
	s, err := OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	// Simulate a database created before the rename: version 1 with the old
	// CHECK allowing only "otongan".
	old := `
	CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
	CREATE TABLE users (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,
	  email TEXT NOT NULL UNIQUE,
	  name TEXT NOT NULL DEFAULT '',
	  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
	  created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE contacts (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,
	  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  name TEXT NOT NULL,
	  nickname TEXT NOT NULL DEFAULT '',
	  notes TEXT NOT NULL DEFAULT '',
	  created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE occasions (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,
	  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
	  type TEXT NOT NULL CHECK (type IN ('birthday','otongan','anniversary')),
	  base_date TEXT NOT NULL,
	  label TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX idx_occasions_contact ON occasions(contact_id);
	CREATE TABLE reminder_prefs (
	  contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
	  offsets TEXT NOT NULL,
	  channel_ids TEXT NOT NULL,
	  enabled INTEGER NOT NULL DEFAULT 1
	);
	INSERT INTO schema_migrations(version) VALUES (1);
	`
	if _, err := s.db.Exec(old); err != nil {
		t.Fatal(err)
	}

	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, err := s.CreateContact(ctx, u.ID, "Made Wijaya", "Made", "cousin")
	if err != nil {
		t.Fatal(err)
	}
	// A row stored under the old spelling must survive the migration.
	if _, err := s.db.Exec(
		`INSERT INTO occasions (contact_id, type, base_date) VALUES (?, 'otongan', '1990-05-12')`, c.ID); err != nil {
		t.Fatal(err)
	}

	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}

	// New inserts use the new spelling; the old CHECK rejected this.
	if _, err := s.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(2001, 2, 3), ""); err != nil {
		t.Fatalf("AddOccasion with renamed type: %v", err)
	}

	got, err := s.GetContact(ctx, u.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	var oldSpelled, converted int
	for _, oc := range got.Occasions {
		switch oc.Type {
		case "otongan":
			oldSpelled++
		case domain.Otonan:
			converted++
		}
	}
	if oldSpelled != 0 || converted != 2 {
		t.Errorf("existing row must be converted to %q, got %d old-spelled and %d %q",
			domain.Otonan, oldSpelled, converted, domain.Otonan)
	}
}
