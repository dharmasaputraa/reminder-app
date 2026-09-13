package store

import (
	"context"
	"database/sql"
	"errors"

	_ "modernc.org/sqlite" // driver "sqlite", pure-Go
)

var ErrNotFound = errors.New("not found")

type Store struct{ db *sql.DB }

const pragmas = `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(pragmas); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// OpenInMemory: dipakai test — satu DB bersama via cache=shared.
// Pragma via DSN (_pragma=...) agar berlaku di SETIAP koneksi pool;
// PRAGMA foreign_keys scopenya per-koneksi.
func OpenInMemory() (*Store, error) {
	db, err := sql.Open("sqlite", "file:otoremtest?mode=memory&cache=shared&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(pragmas); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) Close() error                   { return s.db.Close() }
