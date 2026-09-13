package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"otorem/internal/domain"
)

type Contact struct {
	ID       int64
	OwnerID  int64
	Name     string
	Nickname string
	Notes    string
}

type Occasion struct {
	ID        int64
	ContactID int64
	Type      domain.OccurrenceType
	BaseDate  domain.Date
	Label     string
}

type ReminderPrefs struct {
	ContactID  int64
	Offsets    []int
	ChannelIDs []int64
	Enabled    bool
}

type ContactWithOccasions struct {
	Contact
	Occasions []Occasion
	Prefs     *ReminderPrefs
}

func (s *Store) CreateContact(ctx context.Context, ownerID int64, name, nickname, notes string) (Contact, error) {
	r, err := s.db.ExecContext(ctx,
		`INSERT INTO contacts (owner_id, name, nickname, notes) VALUES (?,?,?,?)`,
		ownerID, name, nickname, notes)
	if err != nil {
		return Contact{}, err
	}
	id, _ := r.LastInsertId()
	return Contact{ID: id, OwnerID: ownerID, Name: name, Nickname: nickname, Notes: notes}, nil
}

func ownerFilter(ownerID int64) string {
	if ownerID == 0 {
		return "1=1" // admin
	}
	return fmt.Sprintf("owner_id = %d", ownerID)
}

func (s *Store) ListContacts(ctx context.Context, ownerID int64) ([]ContactWithOccasions, error) {
	q := fmt.Sprintf(`SELECT id, owner_id, name, nickname, notes FROM contacts WHERE %s ORDER BY name`, ownerFilter(ownerID))
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ContactWithOccasions
	for rows.Next() {
		var c ContactWithOccasions
		if err := rows.Scan(&c.ID, &c.OwnerID, &c.Name, &c.Nickname, &c.Notes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if err := s.fill(ctx, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) GetContact(ctx context.Context, ownerID, contactID int64) (*ContactWithOccasions, error) {
	q := fmt.Sprintf(`SELECT id, owner_id, name, nickname, notes FROM contacts WHERE id = ? AND %s`, ownerFilter(ownerID))
	c := &ContactWithOccasions{}
	err := s.db.QueryRowContext(ctx, q, contactID).Scan(&c.ID, &c.OwnerID, &c.Name, &c.Nickname, &c.Notes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := s.fill(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) fill(ctx context.Context, c *ContactWithOccasions) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, contact_id, type, base_date, label FROM occasions WHERE contact_id = ? ORDER BY base_date`, c.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var o Occasion
		var base string
		if err := rows.Scan(&o.ID, &o.ContactID, &o.Type, &base, &o.Label); err != nil {
			return err
		}
		if o.BaseDate, err = domain.ParseDate(base); err != nil {
			return err
		}
		c.Occasions = append(c.Occasions, o)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	var offsets, channelIDs string
	var enabled int
	err = s.db.QueryRowContext(ctx,
		`SELECT offsets, channel_ids, enabled FROM reminder_prefs WHERE contact_id = ?`, c.ID).
		Scan(&offsets, &channelIDs, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	p := &ReminderPrefs{ContactID: c.ID, Enabled: enabled == 1}
	if err := json.Unmarshal([]byte(offsets), &p.Offsets); err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(channelIDs), &p.ChannelIDs); err != nil {
		return err
	}
	c.Prefs = p
	return nil
}

func (s *Store) UpdateContact(ctx context.Context, ownerID, contactID int64, name, nickname, notes string) error {
	r, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`UPDATE contacts SET name=?, nickname=?, notes=? WHERE id = ? AND %s`, ownerFilter(ownerID)),
		name, nickname, notes, contactID)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteContact(ctx context.Context, ownerID, contactID int64) error {
	r, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM contacts WHERE id = ? AND %s`, ownerFilter(ownerID)), contactID)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AddOccasion(ctx context.Context, contactID int64, typ domain.OccurrenceType, base domain.Date, label string) (Occasion, error) {
	if typ != domain.Birthday && typ != domain.Otonan && typ != domain.Anniversary {
		return Occasion{}, fmt.Errorf("tipe occasion tidak dikenal: %q", typ)
	}
	r, err := s.db.ExecContext(ctx,
		`INSERT INTO occasions (contact_id, type, base_date, label) VALUES (?,?,?,?)`,
		contactID, typ, base.String(), label)
	if err != nil {
		return Occasion{}, err
	}
	id, _ := r.LastInsertId()
	return Occasion{ID: id, ContactID: contactID, Type: typ, BaseDate: base, Label: label}, nil
}

func (s *Store) DeleteOccasion(ctx context.Context, id int64) error {
	r, err := s.db.ExecContext(ctx, `DELETE FROM occasions WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetReminderPrefs(ctx context.Context, p ReminderPrefs) error {
	off, err := json.Marshal(p.Offsets)
	if err != nil {
		return err
	}
	ch, err := json.Marshal(p.ChannelIDs)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO reminder_prefs (contact_id, offsets, channel_ids, enabled)
		VALUES (?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET offsets=excluded.offsets,
		channel_ids=excluded.channel_ids, enabled=excluded.enabled`,
		p.ContactID, string(off), string(ch), boolInt(p.Enabled))
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
