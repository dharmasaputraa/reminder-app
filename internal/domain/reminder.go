package domain

import (
	"fmt"
	"sort"
)

// DefaultOffsets: H-7, H-4, H-2, H-1, H (spec §2, configurable di Settings).
var DefaultOffsets = []int{7, 4, 2, 1, 0}

// ValidateOffsets: non-negatif, tanpa duplikat, ≤ 60 hari (paling jauh 2 bulan).
func ValidateOffsets(offsets []int) error {
	seen := map[int]bool{}
	for _, o := range offsets {
		if o < 0 || o > 60 {
			return fmt.Errorf("offset %d di luar 0..60", o)
		}
		if seen[o] {
			return fmt.Errorf("offset %d duplikat", o)
		}
		seen[o] = true
	}
	return nil
}

// ReminderDates: tanggal-tanggal reminder untuk satu occurrence —
// occurrenceDate − offset, terurut naik, dedupe. Duplikat didedupe sebelum
// validasi sehingga input seperti []int{2, 7, 2, 0} valid.
func ReminderDates(occurrenceDate Date, offsets []int) ([]Date, error) {
	seen := map[int]bool{}
	uniq := make([]int, 0, len(offsets))
	for _, o := range offsets {
		if !seen[o] {
			seen[o] = true
			uniq = append(uniq, o)
		}
	}
	if err := ValidateOffsets(uniq); err != nil {
		return nil, err
	}
	sorted := append([]int(nil), uniq...)
	sort.Sort(sort.Reverse(sort.IntSlice(sorted)))
	out := make([]Date, 0, len(sorted))
	for _, o := range sorted {
		out = append(out, occurrenceDate.AddDays(-o))
	}
	return out, nil
}
