package store

import (
	"context"

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

// RecordNotification: INSERT OR IGNORE — dedupe anti kirim dobel.
// Return inserted=true hanya bila baris benar-benar baru.
func (s *Store) RecordNotification(ctx context.Context, e NotificationEntry) (bool, error) {
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
