// Package calendarprov provides holiday sources. Computed holidays are calculated
// locally from the Pawukon engine; remote providers (Plan 3) add API sources with caching.
package calendarprov

import (
	"context"

	"wimember/internal/domain"
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

// MultiProvider combines providers and filters them by the settings categories.
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
