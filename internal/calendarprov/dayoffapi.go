package calendarprov

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"otorem/internal/domain"
)

// DayOffAPI: Indonesian national holidays & joint leave (including Nyepi).
// Source: github.com/gerinsp/dayoff-API (SKB 3 Menteri / joint-decree data).
type DayOffAPI struct {
	BaseURL string
	hc      *http.Client
}

func NewDayOffAPI() *DayOffAPI {
	return &DayOffAPI{BaseURL: "https://dayoffapi.vercel.app",
		hc: &http.Client{Timeout: 15 * time.Second}}
}

func (d *DayOffAPI) Name() string     { return "dayoffapi" }
func (d *DayOffAPI) Category() string { return "national" }

type dayOffItem struct {
	Tanggal       string `json:"tanggal"`
	Keterangan    string `json:"keterangan"`
	IsCutiBersama bool   `json:"is_cuti_bersama"`
}

func (d *DayOffAPI) fetchYear(ctx context.Context, year int) ([]domain.Holiday, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api?year=%d", d.BaseURL, year), nil)
	if err != nil {
		return nil, err
	}
	resp, err := d.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dayoffapi: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dayoffapi status %d", resp.StatusCode)
	}
	var items []dayOffItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("dayoffapi decode: %w", err)
	}
	var out []domain.Holiday
	for _, it := range items {
		dt, err := time.Parse("2006-01-02", it.Tanggal)
		if err != nil {
			return nil, fmt.Errorf("dayoffapi tanggal %q: %w", it.Tanggal, err)
		}
		name := "Libur Nasional — " + it.Keterangan
		if it.IsCutiBersama {
			name = "Cuti Bersama — " + it.Keterangan
		}
		out = append(out, domain.Holiday{Date: domain.DateFromTime(dt), Name: name})
	}
	return out, nil
}

func (d *DayOffAPI) HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for y := from.Year; y <= to.Year; y++ {
		hs, err := d.fetchYear(ctx, y)
		if err != nil {
			return nil, err
		}
		for _, h := range hs {
			if !h.Date.Before(from) && !h.Date.After(to) {
				out = append(out, h)
			}
		}
	}
	return out, nil
}
