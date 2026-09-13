package domain

import "fmt"

// ParseDate parses "YYYY-MM-DD" (civil).
func ParseDate(s string) (Date, error) {
	var y, m, d int
	if _, err := fmt.Sscanf(s, "%d-%d-%d", &y, &m, &d); err != nil {
		return Date{}, fmt.Errorf("tanggal harus format YYYY-MM-DD: %q", s)
	}
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return Date{}, fmt.Errorf("tanggal tidak valid: %q", s)
	}
	return Date{Year: y, Month: m, Day: d}, nil
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
