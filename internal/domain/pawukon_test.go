package domain

import "testing"

// Anchor verification (spec §5.1): Galungan selalu Buda Kliwon Wuku Dunggulan.
// Tanggal terpublikasi: 23 Apr 2025, 19 Nov 2025, 17 Jun 2026.
// Kuningan = Saniscara Kliwon Wuku Kuningan (Galungan + 10 hari).
func TestPawukonAnchorDates(t *testing.T) {
	cases := []struct {
		d    Date
		want PawukonDate
	}{
		{NewDate(2025, 4, 23), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}},  // Buda Kliwon Dunggulan
		{NewDate(2025, 11, 19), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}}, // Buda Kliwon Dunggulan
		{NewDate(2026, 6, 17), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}},  // Buda Kliwon Dunggulan
		{NewDate(2026, 6, 27), PawukonDate{Saptawara: 6, Pancawara: 3, Wuku: 11}},  // Saniscara Kliwon Kuningan
		{NewDate(2026, 4, 5), PawukonDate{Saptawara: 0, Pancawara: 0, Wuku: 0}},    // hari-1 siklus: Redite Paing Sinta
	}
	for _, c := range cases {
		got := Pawukon(c.d)
		if got != c.want {
			t.Errorf("Pawukon(%s) = %+v, want %+v (%s)", c.d, got, c.want, c.want.Label())
		}
	}
}

// Property: siklus 210 hari tanpa kabisat — Pawukon(d) == Pawukon(d+210k),
// dan saptawara hasil modulo siklus harus = weekday Gregorian (cek silang).
func TestPawukonCycleProperties(t *testing.T) {
	base := NewDate(2000, 1, 1)
	for i := 0; i < 500; i++ {
		d := base.AddDays(i*3 + 11)
		if Pawukon(d) != Pawukon(d.AddDays(PawukonCycleDays)) {
			t.Fatalf("siklus 210 rusak pada %s", d)
		}
		if saptawaraFromCycle := (CycleDay(d) - 1) % 7; saptawaraFromCycle != d.Weekday() {
			t.Fatalf("saptawara siklus %d != weekday %d pada %s", saptawaraFromCycle, d.Weekday(), d)
		}
	}
}

func TestCycleDayAtAnchor(t *testing.T) {
	if got := CycleDay(NewDate(2026, 6, 17)); got != 74 {
		t.Errorf("CycleDay(anchor) = %d, want 74", got)
	}
}
