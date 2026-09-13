package domain

import (
	"fmt"
	"sort"
)

// DefaultOffsets: D-7, D-4, D-2, D-1, D (spec §2, configurable in Settings).
// DefaultOffsets: DO NOT mutate; callers must copy before modifying (package-global).
var DefaultOffsets = []int{7, 4, 2, 1, 0}

// ValidateOffsets: non-negative, no duplicates, ≤ 60 days (at most 2 months).
func ValidateOffsets(offsets []int) error {
	seen := map[int]bool{}
	for _, o := range offsets {
		if o < 0 || o > 60 {
			return fmt.Errorf("offset %d out of range 0..60", o)
		}
		if seen[o] {
			return fmt.Errorf("duplicate offset %d", o)
		}
		seen[o] = true
	}
	return nil
}

// ReminderDates: the reminder dates for one occurrence —
// occurrenceDate − offset, sorted ascending, deduped. Duplicates are deduped
// before validation, so input like []int{2, 7, 2, 0} is valid.
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
