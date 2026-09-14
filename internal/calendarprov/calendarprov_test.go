package calendarprov

import (
	"context"
	"testing"

	"wimember/internal/domain"
)

func TestComputedPawukon(t *testing.T) {
	p := NewComputedPawukon()
	if p.Category() != "pawukon" {
		t.Errorf("category = %q", p.Category())
	}
	hs, err := p.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 7, 31))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, h := range hs {
		found[h.Name] = true
	}
	if !found["Galungan"] || !found["Kuningan"] {
		t.Errorf("Galungan/Kuningan missing: %v", hs)
	}
}

func TestMultiProviderFilter(t *testing.T) {
	m := MultiProvider{Providers: []Provider{NewComputedPawukon()}}
	hs, err := m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30), map[string]bool{"pawukon": false})
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 0 {
		t.Errorf("category off must be empty: %v", hs)
	}
	hs, _ = m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30), map[string]bool{"pawukon": true})
	if len(hs) != 2 {
		t.Errorf("category on: %v", hs)
	}
}
