// Package calendarprov: sumber hari raya. Computed dihitung lokal dari engine
// Pawukon; provider remote (Plan 3) menambah sumber API dengan cache.
package calendarprov

import (
	"context"

	"otorem/internal/domain"
)

type Provider interface {
	Name() string
	Category() string
	HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error)
}

type computedPawukon struct{}

func NewComputedPawukon() Provider       { return computedPawukon{} }
func (computedPawukon) Name() string     { return "pawukon-computed" }
func (computedPawukon) Category() string { return "pawukon" }
func (computedPawukon) HolidaysBetween(_ context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	return domain.PawukonHolidaysBetween(from, to), nil
}

// MultiProvider menggabungkan provider dan memfilter per kategori settings.
type MultiProvider struct{ Providers []Provider }

func (m MultiProvider) HolidaysBetween(ctx context.Context, from, to domain.Date, enabled map[string]bool) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for _, p := range m.Providers {
		if !enabled[p.Category()] {
			continue
		}
		hs, err := p.HolidaysBetween(ctx, from, to)
		if err != nil {
			return nil, err
		}
		out = append(out, hs...)
	}
	return out, nil
}
