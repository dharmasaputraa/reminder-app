package calendarprov

import (
	"context"
	"testing"

	"otorem/internal/domain"
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
		t.Errorf("galungan/kuningan hilang: %v", hs)
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
		t.Errorf("kategori off harus kosong: %v", hs)
	}
	hs, _ = m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30), map[string]bool{"pawukon": true})
	if len(hs) != 2 {
		t.Errorf("kategori on: %v", hs)
	}
}
