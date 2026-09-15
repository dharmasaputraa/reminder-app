package domain

import "testing"

func TestGalunganKuningan2026(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 6, 1), NewDate(2026, 7, 31))
	got := map[Date]string{}
	for _, h := range hs {
		got[h.Date] = h.Name
	}
	if got[NewDate(2026, 6, 17)] != "Galungan" {
		t.Errorf("Galungan 2026-06-17 missing: %v", got)
	}
	if got[NewDate(2026, 6, 27)] != "Kuningan" {
		t.Errorf("Kuningan 2026-06-27 missing: %v", got)
	}
}

// One full cycle (210 days starting at cycle day 1 = 2026-04-05) contains exactly
// once: Galungan (day 74), Kuningan (day 84), Pagerwesi (day 4), Saraswati (day 210).
func TestOneCycleExactHolidays(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 4, 5), NewDate(2026, 4, 5).AddDays(209))
	if len(hs) != 4 {
		t.Fatalf("got %d holidays, want 4: %+v", len(hs), hs)
	}
	names := map[string]bool{}
	for _, h := range hs {
		names[h.Name] = true
	}
	for _, want := range []string{"Galungan", "Kuningan", "Saraswati", "Pagerwesi"} {
		if !names[want] {
			t.Errorf("missing %s in one cycle", want)
		}
	}
}

func TestNormalizeHolidayName(t *testing.T) {
	cases := map[string]string{
		"Saraswati":                      "saraswati",
		"Hari Saraswati":                 "saraswati",
		"Hari Raya Galungan":             "galungan",
		"Galungan":                       "galungan",
		"Hari Raya Nyepi":                "nyepi",
		"Hari Nyepi (Tahun Baru Saka)":   "nyepi",
		"Hari Raya Waisak 2570":          "waisak 2570",
		"Umanis Galungan":                "umanis galungan",
		"Penampahan Galungan":            "penampahan galungan",
		"Hari Proklamasi Kemerdekaan RI": "proklamasi kemerdekaan ri",
		"  Hari   Raya   Kuningan ":      "kuningan",
	}
	for in, want := range cases {
		if got := NormalizeHolidayName(in); got != want {
			t.Errorf("NormalizeHolidayName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHolidayDedupeKey(t *testing.T) {
	pawukon := Holiday{Date: NewDate(2026, 10, 31), Name: "Saraswati"}
	saka := Holiday{Date: NewDate(2026, 10, 31), Name: "Hari Saraswati"}
	if pawukon.DedupeKey() != saka.DedupeKey() {
		t.Errorf("same day + normalized name must share a key: %q vs %q",
			pawukon.DedupeKey(), saka.DedupeKey())
	}
	umanis := Holiday{Date: NewDate(2026, 10, 31), Name: "Umanis Galungan"}
	if pawukon.DedupeKey() == umanis.DedupeKey() {
		t.Error("distinct days (Umanis vs the holiday itself) must not share a key")
	}
	otherDay := Holiday{Date: NewDate(2026, 6, 17), Name: "Hari Raya Galungan"}
	if pawukon.DedupeKey() == otherDay.DedupeKey() {
		t.Error("different dates must not share a key")
	}
}
