package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type Channel struct {
	ID        int64
	OwnerID   int64
	Type      string
	Name      string
	ConfigEnc []byte
	Enabled   bool
}

func (s *Store) CreateChannel(ctx context.Context, ownerID int64, typ, name string, configEnc []byte) (Channel, error) {
	if typ != "gotify" && typ != "telegram" && typ != "email" {
		return Channel{}, fmt.Errorf("unknown channel type: %q", typ)
	}
	r, err := s.db.ExecContext(ctx,
		`INSERT INTO channels (owner_id, type, name, config_enc, enabled) VALUES (?,?,?,?,1)`,
		ownerID, typ, name, configEnc)
	if err != nil {
		return Channel{}, err
	}
	id, _ := r.LastInsertId()
	return Channel{ID: id, OwnerID: ownerID, Type: typ, Name: name, ConfigEnc: configEnc, Enabled: true}, nil
}

func (s *Store) ListChannels(ctx context.Context, ownerID int64) ([]Channel, error) {
	q := `SELECT id, owner_id, type, name, config_enc, enabled FROM channels`
	args := []any{}
	if ownerID != 0 {
		q += ` WHERE owner_id = ?`
		args = append(args, ownerID)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Channel
	for rows.Next() {
		var c Channel
		var en int
		if err := rows.Scan(&c.ID, &c.OwnerID, &c.Type, &c.Name, &c.ConfigEnc, &en); err != nil {
			return nil, err
		}
		c.Enabled = en == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetChannel(ctx context.Context, ownerID, id int64) (*Channel, error) {
	q := `SELECT id, owner_id, type, name, config_enc, enabled FROM channels WHERE id = ?`
	args := []any{id}
	if ownerID != 0 {
		q += ` AND owner_id = ?`
		args = append(args, ownerID)
	}
	c := &Channel{}
	var en int
	err := s.db.QueryRowContext(ctx, q, args...).Scan(&c.ID, &c.OwnerID, &c.Type, &c.Name, &c.ConfigEnc, &en)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.Enabled = en == 1
	return c, nil
}

func (s *Store) SetChannelEnabled(ctx context.Context, ownerID, id int64, enabled bool) error {
	q := `UPDATE channels SET enabled = ? WHERE id = ?`
	args := []any{boolInt(enabled), id}
	if ownerID != 0 { // 0 = admin: see everything, consistent with GetChannel
		q += ` AND owner_id = ?`
		args = append(args, ownerID)
	}
	r, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteChannel(ctx context.Context, ownerID, id int64) error {
	q := `DELETE FROM channels WHERE id = ?`
	args := []any{id}
	if ownerID != 0 { // 0 = admin: see everything, consistent with GetChannel
		q += ` AND owner_id = ?`
		args = append(args, ownerID)
	}
	r, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
