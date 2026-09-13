package store

import (
	"context"
	"errors"
	"testing"
)

func TestHolidayCacheRoundTrip(t *testing.T) {
	st, err := OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// miss → ErrNotFound
	var dst map[string]any
	if err := st.GetHolidayCache(ctx, 2026, "dayoffapi", &dst); !errors.Is(err, ErrNotFound) {
		t.Fatalf("miss: err = %v, want ErrNotFound", err)
	}

	want := map[string]any{"fetched_at": "2026-01-01T00:00:00Z", "holidays": []any{map[string]any{"date": "2026-03-19", "name": "Nyepi"}}}
	if err := st.PutHolidayCache(ctx, 2026, "dayoffapi", want); err != nil {
		t.Fatal(err)
	}
	if err := st.GetHolidayCache(ctx, 2026, "dayoffapi", &dst); err != nil {
		t.Fatal(err)
	}
	if dst["fetched_at"] != want["fetched_at"] {
		t.Errorf("dst = %v, want %v", dst, want)
	}

	// upsert: the same source overwrites the payload, no duplicates
	newer := map[string]any{"fetched_at": "2026-06-01T00:00:00Z"}
	if err := st.PutHolidayCache(ctx, 2026, "dayoffapi", newer); err != nil {
		t.Fatal(err)
	}
	dst = nil
	if err := st.GetHolidayCache(ctx, 2026, "dayoffapi", &dst); err != nil {
		t.Fatal(err)
	}
	if dst["fetched_at"] != newer["fetched_at"] {
		t.Errorf("upsert failed: dst = %v", dst)
	}

	// different (year, source) keys do not interfere with each other
	if err := st.GetHolidayCache(ctx, 2026, "kresnasatya", &dst); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other source: err = %v, want ErrNotFound", err)
	}
}
