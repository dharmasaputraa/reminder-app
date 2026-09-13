package domain

import "testing"

func TestGalunganKuningan2026(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 6, 1), NewDate(2026, 7, 31))
	got := map[Date]string{}
	for _, h := range hs {
		got[h.Date] = h.Name
	}
	if got[NewDate(2026, 6, 17)] != "Galungan" {
		t.Errorf("Galungan 2026-06-17 tidak ada: %v", got)
	}
	if got[NewDate(2026, 6, 27)] != "Kuningan" {
		t.Errorf("Kuningan 2026-06-27 tidak ada: %v", got)
	}
}

// One full cycle (210 days starting at cycle day 1 = 2026-04-05) contains exactly
// once: Galungan (day 74), Kuningan (day 84), Pagerwesi (day 4), Saraswati (day 210).
func TestOneCycleExactHolidays(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 4, 5), NewDate(2026, 4, 5).AddDays(209))
	if len(hs) != 4 {
		t.Fatalf("dapat %d hari raya, want 4: %+v", len(hs), hs)
	}
	names := map[string]bool{}
	for _, h := range hs {
		names[h.Name] = true
	}
	for _, want := range []string{"Galungan", "Kuningan", "Saraswati", "Pagerwesi"} {
		if !names[want] {
			t.Errorf("hilang %s dalam 1 siklus", want)
		}
	}
}
