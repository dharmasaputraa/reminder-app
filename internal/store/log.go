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

// HasNotification: true bila sudah ada baris dengan dedupe key yang sama —
// (occasion XOR holiday key) + occurrence_date + offset_days + channel_id,
// cermin dari kedua partial unique index yang membuat RecordNotification
// idempotent. Binding NULL sama persis (pointer *int64/string → NULL), dan
// guard both-nil sama: dipakai scheduler untuk cek dedupe SEBELUM kirim
// (anti push dobel), bukan pengganti INSERT OR IGNORE.
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

// RecordNotification: INSERT OR IGNORE — dedupe anti kirim dobel.
// Return inserted=true hanya bila baris benar-benar baru.
// Salah satu dari OccasionID/HolidayKey wajib: keduanya nil akan lolos dari
// kedua partial unique index (WHERE ... IS NOT NULL) dan merusak jaminan dedupe.
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
