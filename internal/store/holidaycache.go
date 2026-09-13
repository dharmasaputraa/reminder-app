package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func (s *Store) GetHolidayCache(ctx context.Context, year int, source string, dst any) error {
	var raw string
	err := s.db.QueryRowContext(ctx,
		`SELECT payload FROM holiday_cache WHERE year = ? AND source = ?`, year, source).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(raw), dst)
}

func (s *Store) PutHolidayCache(ctx context.Context, year int, source string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO holiday_cache (year, source, payload)
		VALUES (?,?,?) ON CONFLICT(year, source) DO UPDATE SET payload = excluded.payload,
		fetched_at = (datetime('now'))`, year, source, string(b))
	return err
}
