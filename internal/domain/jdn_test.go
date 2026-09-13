package domain

import "testing"

func TestJDNKnownValues(t *testing.T) {
	cases := []struct {
		d   Date
		jdn int
	}{
		{NewDate(1970, 1, 1), 2440588},
		{NewDate(2000, 1, 1), 2451545},  // Saturday
		{NewDate(2026, 6, 17), 2461209}, // Wednesday (Galungan)
	}
	for _, c := range cases {
		if got := c.d.JDN(); got != c.jdn {
			t.Errorf("JDN(%s) = %d, want %d", c.d, got, c.jdn)
		}
		if back := DateFromJDN(c.jdn); back != c.d {
			t.Errorf("DateFromJDN(%d) = %s, want %s", c.jdn, back, c.d)
		}
	}
}

func TestWeekday(t *testing.T) {
	cases := []struct {
		d    Date
		want int // 0=Sunday … 6=Saturday
	}{
		{NewDate(2000, 1, 1), 6},  // Saturday
		{NewDate(2026, 6, 17), 3}, // Wednesday
	}
	for _, c := range cases {
		if got := c.d.Weekday(); got != c.want {
			t.Errorf("Weekday(%s) = %d, want %d", c.d, got, c.want)
		}
	}
}

func TestAddDaysRoundTrip(t *testing.T) {
	d := NewDate(2026, 2, 28)
	if got := d.AddDays(1); got != NewDate(2026, 3, 1) { // 2026 is not a leap year
		t.Errorf("AddDays(1) dari 2026-02-28 = %s, want 2026-03-01", got)
	}
	if got := d.AddDays(2).AddDays(-2); got != d {
		t.Errorf("round trip: got %s, want %s", got, d)
	}
}
