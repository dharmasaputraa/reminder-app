package domain

import "testing"

func TestNextOccurrenceOtonan(t *testing.T) {
	base := NewDate(2026, 1, 10)
	// Otonan pertama = lahir + 210 hari; inclusive terhadap `from`.
	if occ, _ := NextOccurrence(base, Otonan, base); occ.Date != base.AddDays(210) {
		t.Errorf("otoman pertama = %s, want %s", occ.Date, base.AddDays(210))
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(210)); occ.Number != 1 {
		t.Errorf("Number tepat di hari otonan = %d, want 1 (inklusif)", occ.Number)
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(211)); occ != (Occurrence{
		Date: base.AddDays(420), Type: Otonan, Number: 2,
		Label: "Otonan ke-2 — " + Pawukon(base.AddDays(420)).Label(),
	}) {
		t.Errorf("otoman kedua salah: %+v", occ)
	}
	// konsistensi pawukon: label pawukon tanggal lahir == tanggal otonan
	b, _ := NextOccurrence(base, Otonan, base)
	if Pawukon(base).Label() != Pawukon(b.Date).Label() {
		t.Errorf("pawukon beda: %s vs %s", Pawukon(base).Label(), Pawukon(b.Date).Label())
	}
}

func TestNextOccurrenceBirthday(t *testing.T) {
	leap := NewDate(2000, 2, 29)
	occ, _ := NextOccurrence(leap, Birthday, NewDate(2025, 1, 1))
	if occ.Date != NewDate(2025, 3, 1) || occ.Number != 25 { // 29 Feb → 1 Mar non-kabisat (spec §5.2)
		t.Errorf("29Feb non-kabisat: %+v, want 2025-03-01 umur 25", occ)
	}
	occ, _ = NextOccurrence(leap, Birthday, NewDate(2024, 1, 1))
	if occ.Date != NewDate(2024, 2, 29) || occ.Number != 24 {
		t.Errorf("29Feb kabisat: %+v, want 2024-02-29 umur 24", occ)
	}
	occ, _ = NextOccurrence(NewDate(1990, 12, 30), Birthday, NewDate(2026, 1, 1))
	if occ.Date != NewDate(2026, 12, 30) || occ.Number != 36 {
		t.Errorf("birthday biasa lintas tahun: %+v", occ)
	}
}

func TestOccurrencesBetween(t *testing.T) {
	base := NewDate(2026, 1, 10)
	occs, _ := OccurrencesBetween(base, Otonan, base, base.AddDays(1000))
	if len(occs) != 4 { // hari ke-210,420,630,840,1000? → 210,420,630,840 = 4 saja (1000 < 1050)
		t.Fatalf("dapat %d occurrence, want 4", len(occs))
	}
	if occs[3].Number != 4 {
		t.Errorf("urutan N salah: %+v", occs[3])
	}
	occs2, _ := OccurrencesBetween(NewDate(2026, 6, 20), Birthday, NewDate(2026, 1, 1), NewDate(2026, 12, 31))
	if len(occs2) != 1 || occs2[0].Date != NewDate(2026, 6, 20) {
		t.Errorf("birthday dalam range: %+v", occs2)
	}
}

func TestAge(t *testing.T) {
	if Age(NewDate(2000, 2, 29), NewDate(2025, 3, 1)) != 25 {
		t.Error("age 29Feb")
	}
	if Age(NewDate(1990, 12, 30), NewDate(2026, 12, 29)) != 35 {
		t.Error("age sebelum ultah")
	}
}

// Kontrak NextOccurrence: "next occurrence on or after from" — berlaku juga
// saat base > from+1 tahun (kemunculan berikutnya = base sendiri).
func TestNextOccurrenceBaseAfterFrom(t *testing.T) {
	tests := []struct {
		name string
		base Date
		typ  OccurrenceType
		from Date
		want Occurrence
	}{
		{"birthday base 3 tahun setelah from", NewDate(2029, 6, 1), Birthday, NewDate(2026, 6, 1),
			Occurrence{Date: NewDate(2029, 6, 1), Type: Birthday, Number: 0, Label: "Ulang tahun ke-0"}},
		{"otoman base 3 tahun setelah from", NewDate(2029, 1, 10), Otonan, NewDate(2026, 1, 1),
			Occurrence{Date: NewDate(2029, 1, 10).AddDays(210), Type: Otonan, Number: 1,
				Label: "Otonan ke-1 — " + Pawukon(NewDate(2029, 1, 10).AddDays(210)).Label()}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NextOccurrence(tc.base, tc.typ, tc.from)
			if err != nil {
				t.Fatalf("err tak terduga: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}
