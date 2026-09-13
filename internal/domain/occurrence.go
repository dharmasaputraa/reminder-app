package domain

import "fmt"

type OccurrenceType string

const (
	Birthday    OccurrenceType = "birthday"
	Otonan      OccurrenceType = "otongan"
	Anniversary OccurrenceType = "anniversary"
)

// Occurrence is one concrete happening of a recurring occasion.
// Number semantics: Otonan → cycle number N (N≥1); Birthday → age;
// Anniversary → year number since base.
type Occurrence struct {
	Date   Date
	Type   OccurrenceType
	Number int
	Label  string
}

// NextOccurrence returns the next occurrence on or after `from`.
func NextOccurrence(base Date, typ OccurrenceType, from Date) (Occurrence, error) {
	if base == (Date{}) || base.JDN() <= 0 {
		return Occurrence{}, fmt.Errorf("base date kosong")
	}
	switch typ {
	case Otonan:
		diff := from.JDN() - base.JDN()
		n := diff / PawukonCycleDays
		if diff%PawukonCycleDays != 0 || n == 0 {
			n++
		}
		if n < 1 {
			n = 1
		}
		occ := base.AddDays(n * PawukonCycleDays)
		return Occurrence{Date: occ, Type: Otonan, Number: n,
			Label: fmt.Sprintf("Otonan ke-%d — %s", n, Pawukon(occ).Label())}, nil
	case Birthday, Anniversary:
		// Contract: "next occurrence on or after from". If base > from+1 year,
		// the next occurrence is base itself — check the lower bound year
		// and the year after it (same convention as OccurrencesBetween).
		L := max(from.Year, base.Year)
		U := max(from.Year+1, L)
		for y := L; y <= U; y++ {
			occ := yearlyDate(base, y)
			if occ.Before(from) {
				continue
			}
			return Occurrence{Date: occ, Type: typ, Number: occ.Year - base.Year,
				Label: yearlyLabel(base, occ, typ)}, nil
		}
		return Occurrence{}, fmt.Errorf("occurrence tidak ditemukan dalam 2 tahun: base=%s from=%s", base, from)
	default:
		return Occurrence{}, fmt.Errorf("tipe occurrence tidak dikenal: %q", typ)
	}
}

// yearlyDate: the base anniversary in year y; Feb 29 → Mar 1 in non-leap years.
func yearlyDate(base Date, y int) Date {
	if base.Month == 2 && base.Day == 29 && !isLeap(y) {
		return NewDate(y, 3, 1)
	}
	return NewDate(y, base.Month, base.Day)
}

func yearlyLabel(base, occ Date, typ OccurrenceType) string {
	if typ == Birthday {
		return fmt.Sprintf("Ulang tahun ke-%d", occ.Year-base.Year)
	}
	return fmt.Sprintf("Anniversary ke-%d", occ.Year-base.Year)
}

// OccurrencesBetween returns all occurrences with from ≤ Date ≤ to.
func OccurrencesBetween(base Date, typ OccurrenceType, from, to Date) ([]Occurrence, error) {
	if to.Before(from) {
		return nil, fmt.Errorf("range terbalik: %s > %s", from, to)
	}
	var out []Occurrence
	if typ == Otonan {
		n := 1
		if base.Before(from) {
			diff := from.JDN() - base.JDN()
			n = diff / PawukonCycleDays
			if diff%PawukonCycleDays != 0 {
				n++
			}
			if n < 1 {
				n = 1
			}
		}
		for {
			occDate := base.AddDays(n * PawukonCycleDays)
			if occDate.After(to) {
				break
			}
			out = append(out, Occurrence{Date: occDate, Type: Otonan, Number: n,
				Label: fmt.Sprintf("Otonan ke-%d — %s", n, Pawukon(occDate).Label())})
			n++
		}
		return out, nil
	}
	for y := max(from.Year, base.Year); y <= to.Year; y++ {
		occ := yearlyDate(base, y)
		if occ.Before(from) || occ.After(to) {
			continue
		}
		out = append(out, Occurrence{Date: occ, Type: typ, Number: occ.Year - base.Year,
			Label: yearlyLabel(base, occ, typ)})
	}
	return out, nil
}

// Age: full age on date `on` (safe for Feb 29 → computed from the year).
func Age(base, on Date) int {
	age := on.Year - base.Year
	if yearlyDate(base, on.Year).After(on) {
		age--
	}
	return age
}

func isLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
