package domain

import (
	"fmt"
	"time"
)

// ParseDate parses "YYYY-MM-DD" (civil), strict: menolak input sisa (junk),
// tanpa zero-padding, dan tanggal kalender tidak valid (mis. 2026-02-30).
func ParseDate(s string) (Date, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return Date{}, fmt.Errorf("tanggal harus format YYYY-MM-DD: %q", s)
	}
	return DateFromTime(t), nil
}

func (d Date) MarshalJSON() ([]byte, error) { return []byte(`"` + d.String() + `"`), nil }

func (d *Date) UnmarshalJSON(b []byte) error {
	if len(b) < 2 {
		return fmt.Errorf("tanggal JSON kosong")
	}
	parsed, err := ParseDate(string(b[1 : len(b)-1]))
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}
