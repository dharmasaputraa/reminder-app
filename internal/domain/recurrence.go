package domain

import (
	"fmt"
	"time"
)

// Recurrence is the user-chosen repeat rule of an occasion (stored in
// occasions.recurrence).
type Recurrence string

const (
	RecurOnce        Recurrence = "once"
	RecurYearly      Recurrence = "yearly"
	RecurMonthly     Recurrence = "monthly"
	RecurAnniversary Recurrence = "anniversary"
	RecurOtonan      Recurrence = "otonan"
)

// Stream selects which offset set applies to one occurrence (never stored on
// occasions; derived from recurrence + which mark generated the occurrence).
type Stream string

const (
	StreamEvent   Stream = "event"   // the base date itself / a one-time occasion
	StreamYearly  Stream = "yearly"  // yearly anniversary marks
	StreamMonthly Stream = "monthly" // monthly marks
	StreamOtonan  Stream = "otonan"  // 210-day pawukon marks
)

// OffsetMap maps a stream to its reminder day-offsets. Absent OR empty list
// = inherit from the next layer.
type OffsetMap map[Stream][]int

func ValidateRecurrence(r Recurrence) error {
	switch r {
	case RecurOnce, RecurYearly, RecurMonthly, RecurAnniversary, RecurOtonan:
		return nil
	}
	return fmt.Errorf("unknown recurrence: %q", r)
}

// DefaultRecurrence maps an occasion type to its recurrence when the caller
// does not send one explicitly. Custom/unknown types repeat yearly.
func DefaultRecurrence(t OccurrenceType) Recurrence {
	switch t {
	case Otonan:
		return RecurOtonan
	case Anniversary:
		return RecurAnniversary
	default:
		return RecurYearly
	}
}

// StreamsFor lists the streams a recurrence emits, in a stable order.
func StreamsFor(r Recurrence) []Stream {
	switch r {
	case RecurOnce:
		return []Stream{StreamEvent}
	case RecurYearly:
		return []Stream{StreamEvent, StreamYearly}
	case RecurMonthly:
		return []Stream{StreamEvent, StreamMonthly}
	case RecurAnniversary:
		return []Stream{StreamEvent, StreamYearly, StreamMonthly}
	case RecurOtonan:
		return []Stream{StreamOtonan}
	}
	return nil
}

// DefaultRecurrenceOffsets: the seeded per-stream offset sets. A fresh copy
// every call — callers may mutate.
func DefaultRecurrenceOffsets() OffsetMap {
	return OffsetMap{
		StreamEvent:   {30, 7, 4, 2, 1, 0},
		StreamYearly:  {30, 7, 4, 2, 1, 0},
		StreamMonthly: {0},
		StreamOtonan:  {7, 4, 2, 1, 0},
	}
}

// ValidateOffsetMap: every key must be a known stream, every list must pass
// ValidateOffsets. nil is valid (pure inherit).
func ValidateOffsetMap(m OffsetMap) error {
	for k, v := range m {
		switch k {
		case StreamEvent, StreamYearly, StreamMonthly, StreamOtonan:
		default:
			return fmt.Errorf("unknown offsets stream: %q", k)
		}
		if err := ValidateOffsets(v); err != nil {
			return fmt.Errorf("offsets[%s]: %w", k, err)
		}
	}
	return nil
}

// ResolveOffsets: first layer with a non-empty list for the stream wins;
// nothing anywhere → nil (the caller falls back to DefaultOffsets).
func ResolveOffsets(stream Stream, layers ...OffsetMap) []int {
	for _, m := range layers {
		if len(m[stream]) > 0 {
			return append([]int(nil), m[stream]...)
		}
	}
	return nil
}

// AddMonths: k whole months after base, clamping the day to the target
// month's length (Jan 31 + 1m → Feb 28/29). k must be ≥ 0.
func AddMonths(base Date, k int) Date {
	total := (base.Month - 1) + k
	y := base.Year + total/12
	m := total%12 + 1
	day := base.Day
	if max := daysInMonth(y, m); day > max {
		day = max
	}
	return NewDate(y, m, day)
}

func daysInMonth(y, m int) int {
	return time.Date(y, time.Month(m+1), 0, 0, 0, 0, 0, time.UTC).Day()
}

// MonthsLabel renders a month count: <12 → "N months", ≥12 → "Y years M
// months" (years only when the remainder is 0). Singular-safe.
func MonthsLabel(m int) string {
	if m < 12 {
		if m == 1 {
			return "1 month"
		}
		return fmt.Sprintf("%d months", m)
	}
	y, r := m/12, m%12
	ys := "years"
	if y == 1 {
		ys = "year"
	}
	if r == 0 {
		return fmt.Sprintf("%d %s", y, ys)
	}
	ms := "months"
	if r == 1 {
		ms = "month"
	}
	return fmt.Sprintf("%d %s %d %s", y, ys, r, ms)
}
