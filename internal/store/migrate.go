package store

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func (s *Store) Migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now'))) `); err != nil {
		return err
	}
	entries, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(entries)
	var current int
	if err := s.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM schema_migrations`).Scan(&current); err != nil {
		return err
	}
	for _, e := range entries {
		// file name "001_init.sql" — take the numeric prefix before "_" (also matches "001.sql").
		base := strings.SplitN(strings.TrimSuffix(path.Base(e), ".sql"), "_", 2)[0]
		v, err := strconv.Atoi(base)
		if err != nil {
			return fmt.Errorf("migration name must be NNN_*.sql: %s", e)
		}
		if v <= current {
			continue
		}
		body, err := migrationsFS.ReadFile(e)
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", e, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations(version) VALUES (?)`, v); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
