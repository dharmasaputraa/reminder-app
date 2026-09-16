package domain

import (
	"fmt"
	"strings"
	"unicode"
)

type OccurrenceType string

const (
	Birthday    OccurrenceType = "birthday"
	Otonan      OccurrenceType = "otonan"
	Anniversary OccurrenceType = "anniversary"
)

// Occurrence is one concrete happening of a recurring occasion.
// Number semantics: Otonan → cycle N; Birthday yearly → age; other yearly
// marks → year number; monthly marks → total months; event/once → 0.
type Occurrence struct {
	Date   Date
	Type   OccurrenceType
	Stream Stream
	Number int
	Label  string
}

func NextOccurrence(base Date, typ OccurrenceType, rec Recurrence, from Date) (Occurrence, error) {
	if base == (Date{}) || base.JDN() <= 0 {
		return Occurrence{}, fmt.Errorf("empty base date")
	}
	switch rec {
	case RecurOnce:
		if base.Before(from) {
			return Occurrence{}, fmt.Errorf("once occasion already passed: base=%s from=%s", base, from)
		}
		return Occurrence{Date: base, Type: typ, Stream: StreamEvent, Label: capType(typ)}, nil
	case RecurMonthly, RecurAnniversary:
		k := firstMonthMark(base, from)
		return monthMarkOccurrence(base, typ, rec, k), nil
	case RecurOtonan:
		diff := from.JDN() - base.JDN()
		n := diff / PawukonCycleDays
		if diff%PawukonCycleDays != 0 || n == 0 {
			n++
		}
		if n < 1 {
			n = 1
		}
		occ := base.AddDays(n * PawukonCycleDays)
		return Occurrence{Date: occ, Type: Otonan, Stream: StreamOtonan, Number: n,
			Label: fmt.Sprintf("Otonan #%d — %s", n, Pawukon(occ).Label())}, nil
	case RecurYearly:
		L := max(from.Year, base.Year)
		U := max(from.Year+1, L)
		for y := L; y <= U; y++ {
			occ := yearlyDate(base, y)
			if occ.Before(from) {
				continue
			}
			return yearlyOccurrence(base, typ, occ), nil
		}
		return Occurrence{}, fmt.Errorf("occurrence not found within 2 years: base=%s from=%s", base, from)
	}
	return Occurrence{}, fmt.Errorf("unknown recurrence: %q", rec)
}

func OccurrencesBetween(base Date, typ OccurrenceType, rec Recurrence, from, to Date) ([]Occurrence, error) {
	if to.Before(from) {
		return nil, fmt.Errorf("inverted range: %s > %s", from, to)
	}
	switch rec {
	case RecurOnce:
		if base.Before(from) || base.After(to) {
			return nil, nil
		}
		return []Occurrence{{Date: base, Type: typ, Stream: StreamEvent, Label: capType(typ)}}, nil
	case RecurOtonan:
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
		var out []Occurrence
		for {
			occDate := base.AddDays(n * PawukonCycleDays)
			if occDate.After(to) {
				break
			}
			out = append(out, Occurrence{Date: occDate, Type: Otonan, Stream: StreamOtonan, Number: n,
				Label: fmt.Sprintf("Otonan #%d — %s", n, Pawukon(occDate).Label())})
			n++
		}
		return out, nil
	case RecurYearly:
		var out []Occurrence
		for y := max(from.Year, base.Year); y <= to.Year; y++ {
			occ := yearlyDate(base, y)
			if occ.Before(from) || occ.After(to) {
				continue
			}
			out = append(out, yearlyOccurrence(base, typ, occ))
		}
		return out, nil
	case RecurMonthly, RecurAnniversary:
		var out []Occurrence
		k := firstMonthMark(base, from)
		for {
			occ := monthMarkOccurrence(base, typ, rec, k)
			if occ.Date.After(to) {
				break
			}
			out = append(out, occ)
			k++
		}
		return out, nil
	}
	return nil, fmt.Errorf("unknown recurrence: %q", rec)
}

// firstMonthMark: smallest k with AddMonths(base,k) ≥ from (k=0 when the base
// itself is still upcoming). At most 13 loop iterations after the estimate.
func firstMonthMark(base, from Date) int {
	if !base.Before(from) {
		return 0
	}
	k := (from.Year-base.Year)*12 + (from.Month - base.Month) - 1
	if k < 0 {
		k = 0
	}
	for AddMonths(base, k).Before(from) {
		k++
	}
	return k
}

// monthMarkOccurrence: mark k of a monthly-family recurrence. k=0 is the
// event (stream event, no count); k%12==0 marks are the yearly anniversaries
// (stream yearly, "N years") for RecurAnniversary — they REPLACE the monthly
// entry on that date so each date appears exactly once; RecurMonthly emits
// stream monthly for every k≥1 ("N months" forever).
func monthMarkOccurrence(base Date, typ OccurrenceType, rec Recurrence, k int) Occurrence {
	d := AddMonths(base, k)
	if k == 0 {
		return Occurrence{Date: d, Type: typ, Stream: StreamEvent, Number: 0, Label: capType(typ)}
	}
	if rec == RecurAnniversary && k%12 == 0 {
		return Occurrence{Date: d, Type: typ, Stream: StreamYearly, Number: k / 12,
			Label: fmt.Sprintf("%s %s", capType(typ), MonthsLabel(k))}
	}
	return Occurrence{Date: d, Type: typ, Stream: StreamMonthly, Number: k,
		Label: fmt.Sprintf("%s %s", capType(typ), monthCountLabel(k))}
}

// monthCountLabel renders a monthly-mark count as months only — the yearly
// stream owns the "N years" wording (MonthsLabel would render k=12 as
// "1 year"). Identical to MonthsLabel for k < 12.
func monthCountLabel(k int) string {
	if k == 1 {
		return "1 month"
	}
	return fmt.Sprintf("%d months", k)
}

func yearlyOccurrence(base Date, typ OccurrenceType, occ Date) Occurrence {
	n := occ.Year - base.Year
	if n == 0 {
		return Occurrence{Date: occ, Type: typ, Stream: StreamEvent, Number: 0, Label: capType(typ)}
	}
	if typ == Birthday {
		return Occurrence{Date: occ, Type: typ, Stream: StreamYearly, Number: n, Label: fmt.Sprintf("Birthday #%d", n)}
	}
	return Occurrence{Date: occ, Type: typ, Stream: StreamYearly, Number: n,
		Label: fmt.Sprintf("%s %s", capType(typ), MonthsLabel(n*12))}
}

func capType(t OccurrenceType) string {
	s := string(t)
	if s == "" {
		return "Occasion"
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return strings.TrimSpace(string(r))
}

// yearlyDate: the base anniversary in year y; Feb 29 → Mar 1 in non-leap years.
func yearlyDate(base Date, y int) Date {
	if base.Month == 2 && base.Day == 29 && !isLeap(y) {
		return NewDate(y, 3, 1)
	}
	return NewDate(y, base.Month, base.Day)
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
