package calendarprov

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"otorem/internal/domain"
	"otorem/internal/store"
)

type cachePayload struct {
	FetchedAt time.Time        `json:"fetched_at"`
	Holidays  []domain.Holiday `json:"holidays"`
}

// failBackoffDefault: setelah refresh gagal, tunggu selama ini sebelum
// mencoba remote lagi (negative cache / failure backoff) — scheduler scan
// dan /upcoming tidak boleh menembak remote tiap request saat remote mati.
const failBackoffDefault = 10 * time.Minute

// CachedRemote: cache-first ke holiday_cache (SQLite). Refresh bila payload
// > 24 jam; jika refetch gagal → pakai cache stale (degrade, jangan mati).
// Kegagalan remote dicatat (negative cache): selama window backoff, remote
// tidak dicoba sama sekali — dilayani cache stale bila ada, atau set kosong.
type CachedRemote struct {
	Inner Provider
	St    *store.Store
	// FailBackoff: window backoff setelah kegagalan remote. Diisi default
	// oleh NewCachedRemote; nol/negatif berarti selalu coba lagi (untuk test).
	FailBackoff time.Duration

	mu       sync.Mutex
	lastFail map[int]time.Time // tahun → terakhir kali refresh gagal
}

func NewCachedRemote(inner Provider, st *store.Store) *CachedRemote {
	return &CachedRemote{Inner: inner, St: st, FailBackoff: failBackoffDefault,
		lastFail: map[int]time.Time{}}
}

func (c *CachedRemote) Name() string     { return c.Inner.Name() }
func (c *CachedRemote) Category() string { return c.Inner.Category() }

// inBackoff melaporkan apakah refresh untuk tahun y masih ditahan karena
// kegagalan sebelumnya. Dipanggil dari scheduler loop dan handler API
// secara konkuren → guard dengan mutex.
func (c *CachedRemote) inBackoff(y int) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	last, ok := c.lastFail[y]
	if !ok {
		return false
	}
	window := c.FailBackoff
	if window <= 0 {
		return false // nol/negatif: selalu coba lagi
	}
	return time.Since(last) < window
}

func (c *CachedRemote) markFail(y int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.lastFail == nil {
		c.lastFail = map[int]time.Time{}
	}
	c.lastFail[y] = time.Now()
}

func (c *CachedRemote) clearFail(y int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.lastFail, y)
}

func (c *CachedRemote) loadYear(ctx context.Context, y int) ([]domain.Holiday, bool, error) {
	var p cachePayload
	err := c.St.GetHolidayCache(ctx, y, c.Inner.Name(), &p)
	if err == nil && time.Since(p.FetchedAt) < 24*time.Hour {
		return p.Holidays, true, nil
	}
	// miss atau stale → coba refresh, kecuali masih dalam backoff kegagalan
	if c.inBackoff(y) {
		// Remote baru saja gagal: jangan retry tiap scan/request. Pakai
		// cache stale bila ada, kalau tidak → no-op (set kosong), tanpa
		// HTTP call dan tanpa spam log.
		if err == nil {
			return p.Holidays, true, nil
		}
		return nil, false, nil
	}
	fresh, ferr := c.Inner.HolidaysBetween(ctx, domain.NewDate(y, 1, 1), domain.NewDate(y, 12, 31))
	if ferr == nil {
		c.clearFail(y)
		_ = c.St.PutHolidayCache(ctx, y, c.Inner.Name(), cachePayload{
			FetchedAt: time.Now(), Holidays: fresh,
		})
		return fresh, true, nil
	}
	c.markFail(y)
	if err == nil { // stale cache ada → pakai, jangan gagalkan scheduler
		return p.Holidays, true, nil
	}
	// Cache kosong + remote mati → no-op (set kosong), BUKAN error: sumber
	// computed (pawukon) tetap jalan dan /upcoming tidak boleh 5xx hanya
	// karena API pihak ketiga mati.
	slog.Warn("provider remote gagal, cache kosong → lewati",
		"provider", c.Inner.Name(), "year", y, "err", ferr)
	return nil, false, nil
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
