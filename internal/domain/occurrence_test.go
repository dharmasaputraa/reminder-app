package domain

import "testing"

func TestNextOccurrenceOtonan(t *testing.T) {
	base := NewDate(2026, 1, 10)
	// First otonan = birth + 210 days; inclusive of `from`.
	if occ, _ := NextOccurrence(base, Otonan, base); occ.Date != base.AddDays(210) {
		t.Errorf("first otonan = %s, want %s", occ.Date, base.AddDays(210))
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(210)); occ.Number != 1 {
		t.Errorf("Number exactly on the otonan day = %d, want 1 (inclusive)", occ.Number)
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(211)); occ != (Occurrence{
		Date: base.AddDays(420), Type: Otonan, Number: 2,
		Label: "Otonan #2 — " + Pawukon(base.AddDays(420)).Label(),
	}) {
		t.Errorf("second otonan wrong: %+v", occ)
	}
	// pawukon consistency: the pawukon label of the birth date == that of the otonan date
	b, _ := NextOccurrence(base, Otonan, base)
	if Pawukon(base).Label() != Pawukon(b.Date).Label() {
		t.Errorf("pawukon differs: %s vs %s", Pawukon(base).Label(), Pawukon(b.Date).Label())
	}
}

func TestNextOccurrenceBirthday(t *testing.T) {
	leap := NewDate(2000, 2, 29)
	occ, _ := NextOccurrence(leap, Birthday, NewDate(2025, 1, 1))
	if occ.Date != NewDate(2025, 3, 1) || occ.Number != 25 { // Feb 29 → Mar 1 in non-leap years (spec §5.2)
		t.Errorf("29Feb non-leap: %+v, want 2025-03-01 age 25", occ)
	}
	occ, _ = NextOccurrence(leap, Birthday, NewDate(2024, 1, 1))
	if occ.Date != NewDate(2024, 2, 29) || occ.Number != 24 {
		t.Errorf("29Feb leap: %+v, want 2024-02-29 age 24", occ)
	}
	occ, _ = NextOccurrence(NewDate(1990, 12, 30), Birthday, NewDate(2026, 1, 1))
	if occ.Date != NewDate(2026, 12, 30) || occ.Number != 36 {
		t.Errorf("ordinary birthday across years: %+v", occ)
	}
}

func TestOccurrencesBetween(t *testing.T) {
	base := NewDate(2026, 1, 10)
	occs, _ := OccurrencesBetween(base, Otonan, base, base.AddDays(1000))
	if len(occs) != 4 { // days 210,420,630,840,1000? → 210,420,630,840 = only 4 (1000 < 1050)
		t.Fatalf("got %d occurrences, want 4", len(occs))
	}
	if occs[3].Number != 4 {
		t.Errorf("wrong N order: %+v", occs[3])
	}
	occs2, _ := OccurrencesBetween(NewDate(2026, 6, 20), Birthday, NewDate(2026, 1, 1), NewDate(2026, 12, 31))
	if len(occs2) != 1 || occs2[0].Date != NewDate(2026, 6, 20) {
		t.Errorf("birthday within range: %+v", occs2)
	}
}

func TestAge(t *testing.T) {
	if Age(NewDate(2000, 2, 29), NewDate(2025, 3, 1)) != 25 {
		t.Error("age 29Feb")
	}
	if Age(NewDate(1990, 12, 30), NewDate(2026, 12, 29)) != 35 {
		t.Error("age before birthday")
	}
}

// NextOccurrence contract: "next occurrence on or after from" — also applies
// when base > from+1 year (the next occurrence = base itself).
func TestNextOccurrenceBaseAfterFrom(t *testing.T) {
	tests := []struct {
		name string
		base Date
		typ  OccurrenceType
		from Date
		want Occurrence
	}{
		{"birthday base 3 years after from", NewDate(2029, 6, 1), Birthday, NewDate(2026, 6, 1),
			Occurrence{Date: NewDate(2029, 6, 1), Type: Birthday, Number: 0, Label: "Birthday #0"}},
		{"otoman base 3 years after from", NewDate(2029, 1, 10), Otonan, NewDate(2026, 1, 1),
			Occurrence{Date: NewDate(2029, 1, 10).AddDays(210), Type: Otonan, Number: 1,
				Label: "Otonan #1 — " + Pawukon(NewDate(2029, 1, 10).AddDays(210)).Label()}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NextOccurrence(tc.base, tc.typ, tc.from)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}
