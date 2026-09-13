package calendarprov

import (
	"context"
	"time"

	"otorem/internal/domain"
	"otorem/internal/store"
)

type cachePayload struct {
	FetchedAt time.Time        `json:"fetched_at"`
	Holidays  []domain.Holiday `json:"holidays"`
}

// CachedRemote: cache-first ke holiday_cache (SQLite). Refresh bila payload
// > 24 jam; jika refetch gagal → pakai cache stale (degrade, jangan mati).
type CachedRemote struct {
	Inner Provider
	St    *store.Store
}

func NewCachedRemote(inner Provider, st *store.Store) *CachedRemote {
	return &CachedRemote{Inner: inner, St: st}
}

func (c *CachedRemote) Name() string     { return c.Inner.Name() }
func (c *CachedRemote) Category() string { return c.Inner.Category() }

func (c *CachedRemote) loadYear(ctx context.Context, y int) ([]domain.Holiday, bool, error) {
	var p cachePayload
	err := c.St.GetHolidayCache(ctx, y, c.Inner.Name(), &p)
	if err == nil && time.Since(p.FetchedAt) < 24*time.Hour {
		return p.Holidays, true, nil
	}
	// miss atau stale → coba refresh
	fresh, ferr := c.Inner.HolidaysBetween(ctx, domain.NewDate(y, 1, 1), domain.NewDate(y, 12, 31))
	if ferr == nil {
		_ = c.St.PutHolidayCache(ctx, y, c.Inner.Name(), cachePayload{
			FetchedAt: time.Now(), Holidays: fresh,
		})
		return fresh, true, nil
	}
	if err == nil { // stale cache ada → pakai, jangan gagalkan scheduler
		return p.Holidays, true, nil
	}
	return nil, false, ferr
}

func (c *CachedRemote) HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for y := from.Year; y <= to.Year; y++ {
		hs, ok, err := c.loadYear(ctx, y)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		for _, h := range hs {
			if !h.Date.Before(from) && !h.Date.After(to) {
				out = append(out, h)
			}
		}
	}
	return out, nil
}
