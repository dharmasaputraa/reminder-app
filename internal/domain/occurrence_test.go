package domain

import "testing"

func TestNextOccurrenceOtonan(t *testing.T) {
	base := NewDate(2026, 1, 10)
	// First otonan = birth + 210 days; inclusive of `from`.
	if occ, _ := NextOccurrence(base, Otonan, RecurOtonan, base); occ.Date != base.AddDays(210) {
		t.Errorf("first otonan = %s, want %s", occ.Date, base.AddDays(210))
	}
	if occ, _ := NextOccurrence(base, Otonan, RecurOtonan, base.AddDays(210)); occ.Number != 1 {
		t.Errorf("Number exactly on the otonan day = %d, want 1 (inclusive)", occ.Number)
	}
	if occ, _ := NextOccurrence(base, Otonan, RecurOtonan, base.AddDays(211)); occ != (Occurrence{
		Date: base.AddDays(420), Type: Otonan, Stream: StreamOtonan, Number: 2,
		Label: "Otonan #2 — " + Pawukon(base.AddDays(420)).Label(),
	}) {
		t.Errorf("second otonan wrong: %+v", occ)
	}
	// pawukon consistency: the pawukon label of the birth date == that of the otonan date
	b, _ := NextOccurrence(base, Otonan, RecurOtonan, base)
	if Pawukon(base).Label() != Pawukon(b.Date).Label() {
		t.Errorf("pawukon differs: %s vs %s", Pawukon(base).Label(), Pawukon(b.Date).Label())
	}
}

func TestNextOccurrenceBirthday(t *testing.T) {
	leap := NewDate(2000, 2, 29)
	occ, _ := NextOccurrence(leap, Birthday, RecurYearly, NewDate(2025, 1, 1))
	if occ.Date != NewDate(2025, 3, 1) || occ.Number != 25 { // Feb 29 → Mar 1 in non-leap years (spec §5.2)
		t.Errorf("29Feb non-leap: %+v, want 2025-03-01 age 25", occ)
	}
	occ, _ = NextOccurrence(leap, Birthday, RecurYearly, NewDate(2024, 1, 1))
	if occ.Date != NewDate(2024, 2, 29) || occ.Number != 24 {
		t.Errorf("29Feb leap: %+v, want 2024-02-29 age 24", occ)
	}
	occ, _ = NextOccurrence(NewDate(1990, 12, 30), Birthday, RecurYearly, NewDate(2026, 1, 1))
	if occ.Date != NewDate(2026, 12, 30) || occ.Number != 36 {
		t.Errorf("ordinary birthday across years: %+v", occ)
	}
}

func TestOccurrencesBetween(t *testing.T) {
	base := NewDate(2026, 1, 10)
	occs, _ := OccurrencesBetween(base, Otonan, RecurOtonan, base, base.AddDays(1000))
	if len(occs) != 4 { // days 210,420,630,840,1000? → 210,420,630,840 = only 4 (1000 < 1050)
		t.Fatalf("got %d occurrences, want 4", len(occs))
	}
	if occs[3].Number != 4 {
		t.Errorf("wrong N order: %+v", occs[3])
	}
	occs2, _ := OccurrencesBetween(NewDate(2026, 6, 20), Birthday, RecurYearly, NewDate(2026, 1, 1), NewDate(2026, 12, 31))
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
		rec  Recurrence
		from Date
		want Occurrence
	}{
		{"birthday base 3 years after from", NewDate(2029, 6, 1), Birthday, RecurYearly, NewDate(2026, 6, 1),
			Occurrence{Date: NewDate(2029, 6, 1), Type: Birthday, Stream: StreamEvent, Number: 0, Label: "Birthday"}},
		{"otoman base 3 years after from", NewDate(2029, 1, 10), Otonan, RecurOtonan, NewDate(2026, 1, 1),
			Occurrence{Date: NewDate(2029, 1, 10).AddDays(210), Type: Otonan, Stream: StreamOtonan, Number: 1,
				Label: "Otonan #1 — " + Pawukon(NewDate(2029, 1, 10).AddDays(210)).Label()}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NextOccurrence(tc.base, tc.typ, tc.rec, tc.from)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestOccurrencesBetweenOnce(t *testing.T) {
	base := NewDate(2026, 5, 10)
	occs, err := OccurrencesBetween(base, "graduation", RecurOnce, NewDate(2026, 5, 1), NewDate(2026, 5, 31))
	if err != nil || len(occs) != 1 || occs[0].Date != base || occs[0].Stream != StreamEvent {
		t.Fatalf("once inside range: %v %v", occs, err)
	}
	if occs[0].Label != "Graduation" {
		t.Errorf("once label = %q", occs[0].Label)
	}
	if occs, _ := OccurrencesBetween(base, "graduation", RecurOnce, NewDate(2026, 6, 1), NewDate(2026, 6, 30)); len(occs) != 0 {
		t.Fatalf("once outside range must be empty: %v", occs)
	}
}

func TestOccurrencesBetweenMonthly(t *testing.T) {
	base := NewDate(2025, 6, 16)
	occs, err := OccurrencesBetween(base, "anniversary", RecurMonthly,
		NewDate(2025, 6, 1), NewDate(2026, 6, 30))
	if err != nil {
		t.Fatal(err)
	}
	// k=0 (16 Jun 2025, event) + 12 monthly marks (16 Jul 2025 .. 16 Jun 2026)
	if len(occs) != 13 {
		t.Fatalf("got %d occurrences, want 13: %v", len(occs), occs)
	}
	if occs[0].Stream != StreamEvent || occs[0].Label != "Anniversary" {
		t.Errorf("k=0: %+v", occs[0])
	}
	if occs[1].Stream != StreamMonthly || occs[1].Number != 1 || occs[1].Label != "Anniversary 1 month" {
		t.Errorf("k=1: %+v", occs[1])
	}
	if occs[7].Label != "Anniversary 7 months" {
		t.Errorf("k=7: %+v", occs[7])
	}
	last := occs[12]
	if last.Date != (Date{2026, 6, 16}) || last.Number != 12 || last.Label != "Anniversary 12 months" {
		t.Errorf("k=12 monthly (not yearly — RecurMonthly has no yearly stream): %+v", last)
	}
}

func TestOccurrencesBetweenMonthlyClamp(t *testing.T) {
	base := NewDate(2025, 1, 31)
	occs, _ := OccurrencesBetween(base, "x", RecurMonthly, NewDate(2025, 1, 1), NewDate(2025, 4, 30))
	// Jan 31 (event), Feb 28, Mar 31, Apr 30
	want := []Date{NewDate(2025, 1, 31), NewDate(2025, 2, 28), NewDate(2025, 3, 31), NewDate(2025, 4, 30)}
	if len(occs) != len(want) {
		t.Fatalf("got %d, want %d", len(occs), len(want))
	}
	for i := range want {
		if occs[i].Date != want[i] {
			t.Errorf("mark %d = %s, want %s", i, occs[i].Date, want[i])
		}
	}
}

func TestOccurrencesBetweenAnniversary(t *testing.T) {
	base := NewDate(2025, 6, 16)
	occs, _ := OccurrencesBetween(base, "anniversary", RecurAnniversary,
		NewDate(2025, 6, 1), NewDate(2027, 6, 30))
	// Monthly marks k=0..24 (25) MINUS the 12th/24th monthly marks, which are
	// replaced by yearly ones (still 25 entries total — yearly REPLACES monthly).
	var yearly, monthly []Occurrence
	for _, o := range occs {
		switch o.Stream {
		case StreamYearly:
			yearly = append(yearly, o)
		case StreamMonthly:
			monthly = append(monthly, o)
		}
	}
	if len(yearly) != 2 || yearly[0].Label != "Anniversary 1 year" || yearly[1].Label != "Anniversary 2 years" {
		t.Errorf("yearly marks: %+v", yearly)
	}
	if len(monthly) != 22 {
		t.Errorf("monthly marks: got %d, want 22 (25 minus the k=0 event and the two yearly)", len(monthly))
	}
	if len(occs) != 25 {
		t.Errorf("total %d, want 25", len(occs))
	}
	// The yearly date must not ALSO appear as a monthly mark (dedupe key would
	// merge offset-0 anyway, but the engine replaces the entry).
	for _, o := range monthly {
		if o.Date == (Date{2026, 6, 16}) || o.Date == (Date{2027, 6, 16}) {
			t.Errorf("yearly date leaked into monthly stream: %+v", o)
		}
	}
}

func TestOccurrencesBetweenYearlyEventStream(t *testing.T) {
	// A future base date: k=0 is stream event so it still gets the full ramp.
	occs, err := OccurrencesBetween(NewDate(2026, 9, 20), Birthday, RecurYearly,
		NewDate(2026, 9, 1), NewDate(2027, 9, 30))
	if err != nil || len(occs) != 2 {
		t.Fatalf("got %v, %v — want 2 (event + 1st birthday)", occs, err)
	}
	if occs[0].Stream != StreamEvent || occs[0].Number != 0 || occs[0].Label != "Birthday" {
		t.Errorf("event: %+v", occs[0])
	}
	if occs[1].Stream != StreamYearly || occs[1].Number != 1 || occs[1].Label != "Birthday #1" {
		t.Errorf("yearly: %+v", occs[1])
	}
}

func TestNextOccurrenceNewRecurrences(t *testing.T) {
	base := NewDate(2025, 6, 16)
	o, err := NextOccurrence(base, Anniversary, RecurAnniversary, NewDate(2025, 12, 1))
	if err != nil || o.Date != (Date{2025, 12, 16}) || o.Stream != StreamMonthly {
		t.Fatalf("next monthly mark: %+v %v", o, err)
	}
	o, err = NextOccurrence(base, Anniversary, RecurAnniversary, NewDate(2026, 6, 16))
	if err != nil || o.Date != (Date{2026, 6, 16}) || o.Stream != StreamYearly {
		t.Fatalf("yearly wins on the date: %+v %v", o, err)
	}
	if _, err := NextOccurrence(NewDate(2026, 5, 10), Anniversary, RecurOnce, NewDate(2026, 6, 1)); err == nil {
		t.Error("once in the past: want error")
	}
	o, err = NextOccurrence(NewDate(2026, 5, 10), Anniversary, RecurOnce, NewDate(2026, 5, 1))
	if err != nil || o.Stream != StreamEvent {
		t.Errorf("once upcoming: %+v %v", o, err)
	}
}
