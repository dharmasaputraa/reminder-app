package domain

import (
	"fmt"
	"regexp"
	"strings"
)

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
	// Category: the source category (pawukon/saka/national), stamped by
	// MultiProvider from the producing provider. Empty when a provider is used
	// directly. Drives per-category reminder offsets in /upcoming.
	Category string `json:"category,omitempty"`
}

// Name normalization for cross-source dedup (spec 2026-09-15-holiday-dedup):
// the saka API spells Balinese holidays with honorifics — "Hari Raya
// Galungan", "Hari Saraswati", "Hari Nyepi (Tahun Baru Saka)" — while the
// pawukon defs are bare ("Galungan"). Strip parentheticals and the leading
// "Hari Raya"/"Hari" honorific, lowercase, collapse whitespace. Distinct
// neighboring days never collapse: "Umanis Galungan" keeps its prefix.
var (
	holidayParenRe = regexp.MustCompile(`\([^)]*\)`)
	hariRayaRe     = regexp.MustCompile(`(?i)^\s*hari\s+raya\s+`)
	hariRe         = regexp.MustCompile(`(?i)^\s*hari\s+`)
)

// NormalizeHolidayName reduces an Indonesian holiday name to a comparable
// form. Only for matching (dedup keys), never for display.
func NormalizeHolidayName(name string) string {
	s := holidayParenRe.ReplaceAllString(name, " ")
	s = hariRayaRe.ReplaceAllString(s, "")
	s = hariRe.ReplaceAllString(s, "")
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// DedupeKey: cross-source identity of a holiday — date + normalized name.
// "Saraswati" (pawukon) and "Hari Saraswati" (saka) share a key on the same
// date; "Umanis Galungan" never shares with "Galungan".
func (h Holiday) DedupeKey() string {
	return h.Date.String() + "|" + NormalizeHolidayName(h.Name)
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
