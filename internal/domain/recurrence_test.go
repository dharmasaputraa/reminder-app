package domain

import (
	"reflect"
	"testing"
)

func TestValidateRecurrence(t *testing.T) {
	for _, r := range []Recurrence{RecurOnce, RecurYearly, RecurMonthly, RecurAnniversary, RecurOtonan} {
		if err := ValidateRecurrence(r); err != nil {
			t.Errorf("%q: unexpected error %v", r, err)
		}
	}
	if err := ValidateRecurrence("weekly"); err == nil {
		t.Error("weekly: want error")
	}
}

func TestDefaultRecurrence(t *testing.T) {
	cases := map[OccurrenceType]Recurrence{
		Birthday: RecurYearly, Otonan: RecurOtonan, Anniversary: RecurAnniversary,
		"wedding": RecurYearly, "": RecurYearly,
	}
	for typ, want := range cases {
		if got := DefaultRecurrence(typ); got != want {
			t.Errorf("%q: got %q want %q", typ, got, want)
		}
	}
}

func TestStreamsFor(t *testing.T) {
	cases := map[Recurrence][]Stream{
		RecurOnce:        {StreamEvent},
		RecurYearly:      {StreamEvent, StreamYearly},
		RecurMonthly:     {StreamEvent, StreamMonthly},
		RecurAnniversary: {StreamEvent, StreamYearly, StreamMonthly},
		RecurOtonan:      {StreamOtonan},
	}
	for rec, want := range cases {
		got := StreamsFor(rec)
		if len(got) != len(want) {
			t.Fatalf("%q: got %v want %v", rec, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%q: got %v want %v", rec, got, want)
			}
		}
	}
}

func TestAddMonths(t *testing.T) {
	cases := []struct {
		base Date
		k    int
		want Date
	}{
		{NewDate(2025, 6, 16), 0, NewDate(2025, 6, 16)},
		{NewDate(2025, 6, 16), 1, NewDate(2025, 7, 16)},
		{NewDate(2025, 6, 16), 7, NewDate(2026, 1, 16)},  // year rollover
		{NewDate(2025, 1, 31), 1, NewDate(2025, 2, 28)},  // clamp non-leap
		{NewDate(2024, 1, 31), 1, NewDate(2024, 2, 29)},  // clamp leap
		{NewDate(2025, 1, 31), 13, NewDate(2026, 2, 28)}, // clamp + rollover
		{NewDate(2025, 3, 31), 1, NewDate(2025, 4, 30)},  // clamp 30-day month
	}
	for _, c := range cases {
		if got := AddMonths(c.base, c.k); got != c.want {
			t.Errorf("AddMonths(%s, %d) = %s, want %s", c.base, c.k, got, c.want)
		}
	}
}

func TestMonthsLabel(t *testing.T) {
	cases := map[int]string{
		0: "0 months", 1: "1 month", 5: "5 months",
		12: "1 year", 13: "1 year 1 month", 14: "1 year 2 months", 24: "2 years",
		26: "2 years 2 months",
	}
	for m, want := range cases {
		if got := MonthsLabel(m); got != want {
			t.Errorf("MonthsLabel(%d) = %q, want %q", m, got, want)
		}
	}
}

func TestValidateOffsetMap(t *testing.T) {
	if err := ValidateOffsetMap(nil); err != nil {
		t.Errorf("nil: %v", err)
	}
	if err := ValidateOffsetMap(OffsetMap{StreamMonthly: {0}, StreamYearly: {30, 7}}); err != nil {
		t.Errorf("valid: %v", err)
	}
	if err := ValidateOffsetMap(OffsetMap{"weekly": {0}}); err == nil {
		t.Error("unknown stream key: want error")
	}
	if err := ValidateOffsetMap(OffsetMap{StreamYearly: {61}}); err == nil {
		t.Error("out of range: want error")
	}
}

func TestDefaultRecurrenceOffsets(t *testing.T) {
	want := OffsetMap{
		StreamEvent:   {30, 7, 4, 2, 1, 0},
		StreamYearly:  {30, 7, 4, 2, 1, 0},
		StreamMonthly: {0},
		StreamOtonan:  {7, 4, 2, 1, 0},
	}
	got := DefaultRecurrenceOffsets()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("DefaultRecurrenceOffsets() = %v, want %v", got, want)
	}
	// Fresh copy per call: mutating one result must not leak into the next.
	got[StreamEvent][0] = 99
	if again := DefaultRecurrenceOffsets(); again[StreamEvent][0] != 30 {
		t.Fatalf("mutation leaked into the next call: %v", again)
	}
}

func TestResolveOccasionStreams(t *testing.T) {
	got := ResolveOccasionStreams(RecurAnniversary,
		OffsetMap{StreamMonthly: {1, 0}},
		nil,
		OffsetMap{StreamEvent: {30}, StreamYearly: {30, 7, 0}, StreamMonthly: {0}, StreamOtonan: {7}})
	if len(got) != 3 {
		t.Fatalf("streams: %v", got)
	}
	if len(got[StreamMonthly]) != 2 || got[StreamMonthly][0] != 1 {
		t.Errorf("occasion override: %v", got[StreamMonthly])
	}
	if len(got[StreamEvent]) != 1 || got[StreamEvent][0] != 30 {
		t.Errorf("settings fallback: %v", got[StreamEvent])
	}
	if len(got[StreamYearly]) != 3 {
		t.Errorf("settings fallback yearly: %v", got[StreamYearly])
	}
	all := ResolveOccasionStreams(RecurOtonan, nil, nil, nil)
	if len(all[StreamOtonan]) != len(DefaultOffsets) {
		t.Errorf("DefaultOffsets fallback: %v", all[StreamOtonan])
	}
}

func TestResolveOffsets(t *testing.T) {
	settings := OffsetMap{StreamEvent: {30}, StreamYearly: {30, 7, 0}, StreamMonthly: {0}, StreamOtonan: {7}}
	occ := OffsetMap{StreamMonthly: {1, 0}}
	contact := OffsetMap{StreamYearly: {3, 0}}
	if got := ResolveOffsets(StreamMonthly, occ, contact, settings); len(got) != 2 || got[0] != 1 {
		t.Errorf("occasion override wins: %v", got)
	}
	if got := ResolveOffsets(StreamYearly, occ, contact, settings); len(got) != 2 || got[0] != 3 {
		t.Errorf("contact override wins over settings: %v", got)
	}
	if got := ResolveOffsets(StreamEvent, occ, contact, settings); len(got) != 1 || got[0] != 30 {
		t.Errorf("settings fallback: %v", got)
	}
	if got := ResolveOffsets(StreamOtonan, nil, nil, nil); len(got) != 0 {
		t.Errorf("nothing anywhere → empty (caller falls back to DefaultOffsets): %v", got)
	}
}
