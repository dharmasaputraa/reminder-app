package store

import (
	"context"
	"fmt"

	"otorem/internal/domain"
)

type NotificationEntry struct {
	OccasionID     *int64
	HolidayKey     *string
	OccurrenceDate domain.Date
	OffsetDays     int
	ChannelID      int64
	Status         string
	Error          string
}

// HasNotification: true if a row with the same dedupe key already exists —
// (occasion XOR holiday key) + occurrence_date + offset_days + channel_id,
// mirroring the two partial unique indexes that make RecordNotification
// idempotent. NULL binding matches exactly (pointer *int64/string → NULL), and
// the both-nil guard is the same: used by the scheduler to check dedupe
// BEFORE sending (prevents double pushes), not as a replacement for INSERT OR IGNORE.
func (s *Store) HasNotification(ctx context.Context, e NotificationEntry) (bool, error) {
	if e.OccasionID == nil && e.HolidayKey == nil {
		return false, fmt.Errorf("notification entry harus punya OccasionID atau HolidayKey")
	}
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log
		WHERE ((? IS NOT NULL AND occasion_id = ?) OR (? IS NOT NULL AND holiday_key = ?))
		AND occurrence_date = ? AND offset_days = ? AND channel_id = ?`,
		e.OccasionID, e.OccasionID, e.HolidayKey, e.HolidayKey,
		e.OccurrenceDate.String(), e.OffsetDays, e.ChannelID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// RecordNotification: INSERT OR IGNORE — dedupe against double sends.
// Returns inserted=true only when the row is really new.
// One of OccasionID/HolidayKey is required: both nil would slip past both
// partial unique indexes (WHERE ... IS NOT NULL) and break the dedupe guarantee.
func (s *Store) RecordNotification(ctx context.Context, e NotificationEntry) (bool, error) {
	if e.OccasionID == nil && e.HolidayKey == nil {
		return false, fmt.Errorf("notification entry harus punya OccasionID atau HolidayKey")
	}
	r, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO notification_log
		(occasion_id, holiday_key, occurrence_date, offset_days, channel_id, status, error)
		VALUES (?,?,?,?,?,?,?)`,
		e.OccasionID, e.HolidayKey, e.OccurrenceDate.String(), e.OffsetDays, e.ChannelID, e.Status, e.Error)
	if err != nil {
		return false, err
	}
	n, err := r.RowsAffected()
	return n > 0, err
}
