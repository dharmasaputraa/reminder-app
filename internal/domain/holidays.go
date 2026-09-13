package domain

import "fmt"

// HolidayDef: one Pawukon holiday = a combination of (saptawara, pancawara, wuku).
type HolidayDef struct {
	Name      string
	Saptawara int
	Pancawara int
	Wuku      int
}

// ONLY definitions that are standard and verified (spec §5.3). To add a
// definition (the Tumpek series, Sugihan, etc.) you MUST: first add a row to
// the scraper fixture, prove the dates match, and only then add it here.
// PawukonHolidayDefs: DO NOT mutate; callers must copy before modifying (package-global).
var PawukonHolidayDefs = []HolidayDef{
	{Name: "Galungan", Saptawara: 3, Pancawara: 3, Wuku: 10},  // Buda Kliwon Dunggulan
	{Name: "Kuningan", Saptawara: 6, Pancawara: 3, Wuku: 11},  // Saniscara Kliwon Kuningan
	{Name: "Saraswati", Saptawara: 6, Pancawara: 4, Wuku: 29}, // Saniscara Umanis Watugunung
	{Name: "Pagerwesi", Saptawara: 3, Pancawara: 3, Wuku: 0},  // Buda Kliwon Sinta
}

type Holiday struct {
	Date Date
	Name string
}

// PawukonHolidaysBetween returns Pawukon-based holidays in [from, to].
// O( number of days × number of definitions ) — trivial for the app's horizon range.
func PawukonHolidaysBetween(from, to Date) []Holiday {
	var out []Holiday
	for d := from; !d.After(to); d = d.AddDays(1) {
		p := Pawukon(d)
		for _, h := range PawukonHolidayDefs {
			if p.Saptawara == h.Saptawara && p.Pancawara == h.Pancawara && p.Wuku == h.Wuku {
				out = append(out, Holiday{Date: d, Name: h.Name})
				break
			}
		}
	}
	return out
}

func (h Holiday) String() string { return fmt.Sprintf("%s (%s)", h.Name, h.Date) }
