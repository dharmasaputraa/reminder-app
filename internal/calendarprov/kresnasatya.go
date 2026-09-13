package calendarprov

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"otorem/internal/domain"
)

// Kresna: national + Bali regional holidays (Galungan, Kuningan, Saraswati, etc.).
// Source: github.com/kresnasatya/api-harilibur.
type Kresna struct {
	BaseURL string
	hc      *http.Client
}

func NewKresna(baseURL string) *Kresna {
	if baseURL == "" {
		baseURL = "https://artworks.kresna.me/api-harilibur"
	}
	return &Kresna{BaseURL: baseURL, hc: &http.Client{Timeout: 15 * time.Second}}
}

func (k *Kresna) Name() string     { return "kresnasatya" }
func (k *Kresna) Category() string { return "saka" }

type kresnaItem struct {
	HolidayDate string `json:"holiday_date"`
	HolidayName string `json:"holiday_name"`
}

func (k *Kresna) fetchYear(ctx context.Context, year int) ([]domain.Holiday, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api?year=%d", k.BaseURL, year), nil)
	if err != nil {
		return nil, err
	}
	resp, err := k.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kresna: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("kresna status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	// the source response may be a bare array or wrapped in {"data":[...]}
	var items []kresnaItem
	if err := json.Unmarshal(raw, &items); err != nil {
		var wrapped struct {
			Data []kresnaItem `json:"data"`
		}
		if err2 := json.Unmarshal(raw, &wrapped); err2 != nil {
			return nil, fmt.Errorf("kresna decode: %w / %w", err, err2)
		}
		items = wrapped.Data
	}
	var out []domain.Holiday
	for _, it := range items {
		dt, err := time.Parse("2006-01-02", it.HolidayDate)
		if err != nil {
			return nil, fmt.Errorf("kresna date %q: %w", it.HolidayDate, err)
		}
		out = append(out, domain.Holiday{Date: domain.DateFromTime(dt), Name: it.HolidayName})
	}
	return out, nil
}

func (k *Kresna) HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for y := from.Year; y <= to.Year; y++ {
		hs, err := k.fetchYear(ctx, y)
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
