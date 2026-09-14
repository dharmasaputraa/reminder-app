# Holiday Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two dead remote holiday providers with the working api-harilibur source (national/saka split), populate `reminders` + `reminders_default` in `/upcoming`, and render Google-Calendar-style `Default (D-7, D-4, …)` in the event detail surfaces.

**Architecture:** `domain.Holiday` gains a `Category` field that `MultiProvider` fills from the producing provider. The `Kresna` provider is rewritten to filter one shared source (api-harilibur) into a `national` and a `saka` provider instance with a fallback mirror; `DayOffAPI` is deleted. `/upcoming` resolves each item's effective offsets exactly like the scheduler (per-category → global default fallback) and sends a `reminders_default` flag; the frontend renders `Default (…)` vs `D-N` badges from that flag.

**Tech Stack:** Go 1.26 (gin, testing via `httptest`), React 19 + TypeScript + TanStack Query, Tailwind v4. Spec: `docs/superpowers/specs/2026-09-14-holiday-reminders-design.md`.

## Global Constraints

- Go module is `wimember`; all Go commands run from repo root `/Users/taksu/Work/code/otorem`.
- Web commands run from `web/` (`pnpm lint`, `pnpm build`; no test harness — lint + `tsc -b` via build is the frontend gate).
- Commit style follows repo convention: `feat(scope): …` / `fix(scope): …` / `docs: …`.
- `domain.DefaultOffsets = []int{7, 4, 2, 1, 0}`; `ValidateOffsets` requires non-negative, unique, ≤60.
- Provider interface (unchanged): `Name() string`, `Category() string`, `HolidaysBetween(ctx, from, to domain.Date) ([]domain.Holiday, error)`.
- `CachedRemote` behavior (stale fallback, failure backoff) must not change.
- Production provider names move to `harilibur-national` / `harilibur-saka` (used as `holiday_cache.source` keys; old cache rows are orphaned harmlessly — the table is empty today).
- Live API facts (verified 2026-09-14): `api-harilibur.pages.dev` and `api-harilibur.netlify.app` return 200; `api-harilibur.vercel.app` and `dayoffapi.vercel.app` return 402; `artworks.kresna.me` returns 404. Response items: `{"holiday_date":"2026-12-25","holiday_name":"Hari Raya Natal","is_national_holiday":true}` (bare array or `{"data":[...]}` wrapper).

---

### Task 1: `Holiday.Category` + MultiProvider tagging

**Files:**
- Modify: `internal/domain/holidays.go:24-27`
- Modify: `internal/calendarprov/calendarprov.go:29-42`
- Test: `internal/calendarprov/calendarprov_test.go`

**Interfaces:**
- Consumes: existing `Provider` interface and `MultiProvider.HolidaysBetween(ctx, from, to, enabled map[string]bool)`.
- Produces: `domain.Holiday{Date Date; Name string; Category string}` — `Category` filled by `MultiProvider` from `p.Category()`; `""` when a provider is used directly. Task 4 reads `h.Category`.

- [ ] **Step 1: Write the failing test**

Append to `internal/calendarprov/calendarprov_test.go`:

```go
// stubProvider: minimal in-memory provider for MultiProvider tests.
type stubProvider struct {
	name, cat string
	hs        []domain.Holiday
}

func (s stubProvider) Name() string     { return s.name }
func (s stubProvider) Category() string { return s.cat }
func (s stubProvider) HolidaysBetween(_ context.Context, _ domain.Date, _ domain.Date) ([]domain.Holiday, error) {
	return s.hs, nil
}

// TestMultiProviderTagsCategory: MultiProvider stamps each holiday with the
// producing provider's category so consumers (/upcoming) can resolve
// per-category reminder offsets without their own provider loop.
func TestMultiProviderTagsCategory(t *testing.T) {
	m := MultiProvider{Providers: []Provider{stubProvider{name: "stub", cat: "pawukon",
		hs: []domain.Holiday{{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}}}}}
	hs, err := m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30), map[string]bool{"pawukon": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 1 || hs[0].Category != "pawukon" {
		t.Errorf("hs = %+v, want one holiday tagged Category=pawukon", hs)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/calendarprov/ -run TestMultiProviderTagsCategory -v`
Expected: FAIL — `hs[0].Category` is `""` (field does not exist yet → compile error `unknown field Category`).

- [ ] **Step 3: Implement**

In `internal/domain/holidays.go`, change the `Holiday` struct (line 24) to:

```go
type Holiday struct {
	Date Date
	Name string
	// Category: the source category (pawukon/saka/national), stamped by
	// MultiProvider from the producing provider. Empty when a provider is used
	// directly. Drives per-category reminder offsets in /upcoming.
	Category string `json:"category,omitempty"`
}
```

In `internal/calendarprov/calendarprov.go`, change the append loop in `MultiProvider.HolidaysBetween` to:

```go
		for _, h := range hs {
			h.Category = p.Category()
			out = append(out, h)
		}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/calendarprov/ ./internal/scheduler/ -v`
Expected: PASS (all, including existing `TestMultiProviderFilter`).

- [ ] **Step 5: Commit**

```bash
git add internal/domain/holidays.go internal/calendarprov/calendarprov.go internal/calendarprov/calendarprov_test.go
git commit -m "feat(calendarprov): tag holidays with source category via MultiProvider"
```

---

### Task 2: Rewrite Kresna — national/saka filter + fallback mirror

**Files:**
- Modify: `internal/calendarprov/kresnasatya.go` (full rewrite)
- Test: `internal/calendarprov/remote_test.go` (replace `TestKresnaParseWrapped`, `TestKresnaStatusCheck`; add filter + fallback tests)

**Interfaces:**
- Consumes: `domain.Holiday`, `domain.DateFromTime`, `domain.Date`.
- Produces:
  - `NewKresna(baseURL string) *Kresna` — all holidays, no filter, no fallback (tests/simple use).
  - `NewKresnaFiltered(baseURL, fallbackBaseURL string, nationalOnly bool) *Kresna` — one category of the shared source; empty `fallbackBaseURL` = no fallback.
  - `Name()`: `"harilibur-national"` (nationalOnly) / `"harilibur-saka"`; `Category()`: `"national"` / `"saka"`.
  - Empty `baseURL` defaults to `https://api-harilibur.pages.dev`.
  Task 3 wires `NewKresnaFiltered` and relies on these names/categories.

- [ ] **Step 1: Write the failing tests**

In `internal/calendarprov/remote_test.go`, replace `TestKresnaParseWrapped` and `TestKresnaStatusCheck` with:

```go
const hariliburFixture = `[{"holiday_date":"2026-12-25","holiday_name":"Hari Raya Natal","is_national_holiday":true},
	{"holiday_date":"2026-10-31","holiday_name":"Hari Saraswati","is_national_holiday":false}]`

func TestKresnaParseWrapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":`+hariliburFixture+`}`)
	}))
	defer srv.Close()
	k := NewKresna(srv.URL)
	hs, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 12, 31))
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 2 || hs[0].Name != "Hari Raya Natal" {
		t.Errorf("hs = %+v", hs)
	}
}

// TestKresnaNationalFilter: one source, two categories — nationalOnly=true
// keeps is_national_holiday items, false keeps the Bali/Saka remainder.
func TestKresnaNationalFilter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, hariliburFixture)
	}))
	defer srv.Close()
	nat := NewKresnaFiltered(srv.URL, "", true)
	saka := NewKresnaFiltered(srv.URL, "", false)
	if nat.Name() != "harilibur-national" || nat.Category() != "national" {
		t.Errorf("nat name/category = %q/%q", nat.Name(), nat.Category())
	}
	if saka.Name() != "harilibur-saka" || saka.Category() != "saka" {
		t.Errorf("saka name/category = %q/%q", saka.Name(), saka.Category())
	}
	ctx := context.Background()
	rng := []domain.Date{domain.NewDate(2026, 12, 1), domain.NewDate(2026, 12, 31)}
	nhs, err := nat.HolidaysBetween(ctx, rng[0], rng[1])
	if err != nil {
		t.Fatal(err)
	}
	if len(nhs) != 1 || nhs[0].Name != "Hari Raya Natal" {
		t.Errorf("national hs = %+v", nhs)
	}
	shs, err := saka.HolidaysBetween(ctx, domain.NewDate(2026, 10, 1), domain.NewDate(2026, 10, 31))
	if err != nil {
		t.Fatal(err)
	}
	if len(shs) != 1 || shs[0].Name != "Hari Saraswati" {
		t.Errorf("saka hs = %+v", shs)
	}
}

// TestKresnaFallbackMirror: primary mirror down (e.g. 402/5xx) → one retry on
// the fallback mirror before the provider reports failure.
func TestKresnaFallbackMirror(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Payment required\n\nDEPLOYMENT_DISABLED", http.StatusPaymentRequired)
	}))
	defer primary.Close()
	fallbackCalled := false
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fallbackCalled = true
		io.WriteString(w, `[{"holiday_date":"2026-12-25","holiday_name":"Hari Raya Natal","is_national_holiday":true}]`)
	}))
	defer fallback.Close()
	k := NewKresnaFiltered(primary.URL, fallback.URL, true)
	hs, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 12, 1), domain.NewDate(2026, 12, 31))
	if err != nil {
		t.Fatalf("fallback must recover: %v", err)
	}
	if !fallbackCalled {
		t.Error("fallback mirror was not called")
	}
	if len(hs) != 1 || hs[0].Name != "Hari Raya Natal" {
		t.Errorf("hs = %+v", hs)
	}
}

// TestKresnaBothMirrorsFail: no fallback configured (or both down) → error,
// which CachedRemote degrades per its own policy.
func TestKresnaBothMirrorsFail(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusInternalServerError)
	}))
	defer down.Close()
	k := NewKresnaFiltered(down.URL, down.URL, true)
	_, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 12, 1), domain.NewDate(2026, 12, 31))
	if err == nil {
		t.Fatal("both mirrors down must produce an error")
	}
	if !strings.Contains(err.Error(), "status 500") {
		t.Errorf("err = %v, want it to contain \"status 500\"", err)
	}
}

func TestKresnaStatusCheck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()
	k := NewKresna(srv.URL) // no fallback → single attempt
	_, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30))
	if err == nil {
		t.Fatal("404 must produce an error")
	}
	if !strings.Contains(err.Error(), "status 404") {
		t.Errorf("err = %v, want it to contain \"status 404\"", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/calendarprov/ -run 'TestKresna' -v`
Expected: FAIL to compile — `NewKresnaFiltered` and `FallbackBaseURL` undefined.

- [ ] **Step 3: Rewrite `internal/calendarprov/kresnasatya.go`**

Replace the whole file with:

```go
package calendarprov

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"wimember/internal/domain"
)

// Kresna: Indonesian holidays from github.com/kresnasatya/api-harilibur — one
// source covering national holidays (is_national_holiday=true) and Bali/Saka
// regional ones (false). Official mirrors: api-harilibur.pages.dev (primary)
// and api-harilibur.netlify.app (fallback). The old artworks.kresna.me host
// 404s and dayoffapi.vercel.app is dead (402 DEPLOYMENT_DISABLED).
type Kresna struct {
	BaseURL         string
	FallbackBaseURL string
	// NationalOnly: nil → keep every holiday (tests / simple use); non-nil →
	// keep only items whose is_national_holiday matches the pointed value.
	NationalOnly *bool
	hc           *http.Client
}

// NewKresna: all holidays, no national/saka split and no fallback mirror.
// Production uses NewKresnaFiltered to derive the two categories.
func NewKresna(baseURL string) *Kresna { return newKresna(baseURL, "", nil) }

// NewKresnaFiltered: one category of the shared source — nationalOnly=true
// keeps national holidays, false keeps the Bali/Saka remainder. An empty
// fallbackBaseURL disables the fallback retry.
func NewKresnaFiltered(baseURL, fallbackBaseURL string, nationalOnly bool) *Kresna {
	return newKresna(baseURL, fallbackBaseURL, &nationalOnly)
}

func newKresna(baseURL, fallbackBaseURL string, nationalOnly *bool) *Kresna {
	if baseURL == "" {
		baseURL = "https://api-harilibur.pages.dev"
	}
	return &Kresna{BaseURL: baseURL, FallbackBaseURL: fallbackBaseURL,
		NationalOnly: nationalOnly, hc: &http.Client{Timeout: 15 * time.Second}}
}

func (k *Kresna) Name() string {
	if k.NationalOnly != nil && *k.NationalOnly {
		return "harilibur-national"
	}
	return "harilibur-saka"
}

func (k *Kresna) Category() string {
	if k.NationalOnly != nil && *k.NationalOnly {
		return "national"
	}
	return "saka"
}

type kresnaItem struct {
	HolidayDate       string `json:"holiday_date"`
	HolidayName       string `json:"holiday_name"`
	IsNationalHoliday bool   `json:"is_national_holiday"`
}

// keep: the national/saka split of the shared source.
func (k *Kresna) keep(it kresnaItem) bool {
	if k.NationalOnly == nil {
		return true
	}
	return it.IsNationalHoliday == *k.NationalOnly
}

func (k *Kresna) fetchYear(ctx context.Context, year int) ([]domain.Holiday, error) {
	hs, err := k.fetchYearFrom(ctx, k.BaseURL, year)
	if err != nil && k.FallbackBaseURL != "" && k.FallbackBaseURL != k.BaseURL {
		// primary mirror down → one retry on the fallback mirror
		hs, err = k.fetchYearFrom(ctx, k.FallbackBaseURL, year)
	}
	return hs, err
}

func (k *Kresna) fetchYearFrom(ctx context.Context, base string, year int) ([]domain.Holiday, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api?year=%d", base, year), nil)
	if err != nil {
		return nil, err
	}
	resp, err := k.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("harilibur: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("harilibur status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	// the source response may be a bare array or wrapped in {"data":[...]}
	var items []kresnaItem
	if err := json.Unmarshal(raw, &items); err != nil {
		var wrapped struct {
			Data []kresnaItem `json:"data"`
		}
		if err2 := json.Unmarshal(raw, &wrapped); err2 != nil {
			return nil, fmt.Errorf("harilibur decode: %w / %w", err, err2)
		}
		items = wrapped.Data
	}
	var out []domain.Holiday
	for _, it := range items {
		if !k.keep(it) {
			continue
		}
		dt, err := time.Parse("2006-01-02", it.HolidayDate)
		if err != nil {
			return nil, fmt.Errorf("harilibur date %q: %w", it.HolidayDate, err)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/calendarprov/ -v`
Expected: PASS — but `TestDayOffAPIParse` and the `TestCachedRemote*` tests still reference `NewDayOffAPI` (still compiles at this point; they get ported in Task 3). Only the `TestKresna*` set must be green.

- [ ] **Step 5: Commit**

```bash
git add internal/calendarprov/kresnasatya.go internal/calendarprov/remote_test.go
git commit -m "feat(calendarprov): split api-harilibur into national/saka categories with fallback mirror"
```

---

### Task 3: Delete DayOffAPI, port CachedRemote tests, wire main.go

**Files:**
- Delete: `internal/calendarprov/dayoffapi.go`
- Modify: `internal/calendarprov/remote_test.go` (port `TestCachedRemote*` off DayOffAPI, drop `TestDayOffAPIParse`)
- Modify: `cmd/server/main.go:49-53`

**Interfaces:**
- Consumes: `NewKresnaFiltered(baseURL, fallbackBaseURL string, nationalOnly bool)` from Task 2; `CachedRemote` unchanged (`NewCachedRemote(inner Provider, st *store.Store)`).
- Produces: production provider set = pawukon + `harilibur-national` + `harilibur-saka`, each wrapped in `CachedRemote`. Scheduler and `/upcoming` consume the same `[]calendarprov.Provider` as before.

- [ ] **Step 1: Port the CachedRemote tests**

In `internal/calendarprov/remote_test.go`:

1. Delete `TestDayOffAPIParse` (the source is dead; the Kresna tests replace its coverage).
2. Add this helper above the CachedRemote tests:

```go
// newTestRemote: a Kresna wired to a test server, national category, no
// fallback (offline-safe; "" disables the mirror retry).
func newTestRemote(url string) *Kresna {
	return NewKresnaFiltered(url, "", true)
}
```

3. In `TestCachedRemoteCacheFirst`, replace the server body and inner construction:

```go
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		io.WriteString(w, `[{"holiday_date":"2026-03-19","holiday_name":"Nyepi","is_national_holiday":true}]`)
	}))
	defer srv.Close()
	inner := newTestRemote(srv.URL)
```

4. In `TestCachedRemoteStaleFallback`, replace the stale-payload insertion and server/inner construction so the cache is keyed by the provider's real name instead of the hard-coded `"dayoffapi"`:

```go
	stale := cachePayload{
		FetchedAt: time.Now().Add(-48 * time.Hour),
		Holidays:  []domain.Holiday{{Date: domain.NewDate(2026, 3, 19), Name: "Nyepi"}},
	}

	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, "down", http.StatusInternalServerError)
	}))
	defer srv.Close()
	inner := newTestRemote(srv.URL)
	c := NewCachedRemote(inner, st)
	if err := st.PutHolidayCache(context.Background(), 2026, c.Inner.Name(), stale); err != nil {
		t.Fatal(err)
	}
```

…and change the assertion from `hs[0].Name != "National Holiday — Nyepi"` to `hs[0].Name != "Nyepi"`. (The `PutHolidayCache` call moves to AFTER `c := NewCachedRemote(...)`; delete the old block that inserted under `"dayoffapi"` before the server setup.)

5. In `TestCachedRemoteFailureBackoff` and `TestCachedRemoteBackoffClearedOnSuccess`, replace `inner := NewDayOffAPI(); inner.BaseURL = srv.URL` with `inner := newTestRemote(srv.URL)`; in the latter also change the healthy-response fixture to `[{"holiday_date":"2026-03-19","holiday_name":"Nyepi","is_national_holiday":true}]`.

- [ ] **Step 2: Delete DayOffAPI and verify the package compiles**

```bash
rm internal/calendarprov/dayoffapi.go
go build ./... 2>&1 | head -20
```

Expected: `cmd/server/main.go` fails to compile (`NewDayOffAPI` undefined) — that is the next step's trigger; the `internal/...` packages must compile.

- [ ] **Step 3: Wire main.go**

Replace `cmd/server/main.go:49-53` with:

```go
	// api-harilibur mirrors: pages.dev primary, netlify.app fallback. The old
	// sources are dead — dayoffapi.vercel.app (402 DEPLOYMENT_DISABLED) and
	// artworks.kresna.me (404). One source, two categories via is_national_holiday.
	hariliburPrimary := "https://api-harilibur.pages.dev"
	hariliburFallback := "https://api-harilibur.netlify.app"
	providers := []calendarprov.Provider{
		calendarprov.NewComputedPawukon(),
		calendarprov.NewCachedRemote(calendarprov.NewKresnaFiltered(hariliburPrimary, hariliburFallback, true), st),
		calendarprov.NewCachedRemote(calendarprov.NewKresnaFiltered(hariliburPrimary, hariliburFallback, false), st),
	}
```

- [ ] **Step 4: Run the full Go test suite**

Run: `go test ./...`
Expected: PASS everywhere.

- [ ] **Step 5: Commit**

```bash
git add -A internal/calendarprov cmd/server/main.go
git commit -m "feat(calendarprov): replace dead dayoffapi/kresnasatya hosts with api-harilibur mirrors"
```

---

### Task 4: `/upcoming` reminders + `reminders_default`

**Files:**
- Modify: `internal/api/upcoming.go:15-27` (struct) and `:87-120` (loops)
- Test: `internal/api/upcoming_test.go` (new)

**Interfaces:**
- Consumes: `domain.Holiday.Category` (Task 1), `store.ReminderPrefs{ContactID int64; Offsets []int; ChannelIDs []int64; Enabled bool}`, `settings.HolidayOffsets map[string][]int`, `domain.DefaultOffsets`.
- Produces: `UpcomingItem` JSON gains `reminders_default` (bool, `omitempty`). Semantics locked for the frontend (Task 5): `reminders` = effective offsets (per-category for holidays / prefs for occasions), `reminders_default: true` ⇔ they came from the global `default_offsets` fallback.

- [ ] **Step 1: Write the failing tests**

Create `internal/api/upcoming_test.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"wimember/internal/calendarprov"
	"wimember/internal/config"
	"wimember/internal/domain"
	"wimember/internal/store"
)

// stubProv: deterministic holiday provider for /upcoming tests.
type stubProv struct {
	name, cat string
	hs        []domain.Holiday
}

func (s stubProv) Name() string     { return s.name }
func (s stubProv) Category() string { return s.cat }
func (s stubProv) HolidaysBetween(_ context.Context, _ domain.Date, _ domain.Date) ([]domain.Holiday, error) {
	return s.hs, nil
}

func newUpcomingTestServer(t *testing.T, provs []calendarprov.Provider) (*Server, *store.Store) {
	t.Helper()
	ginSet(t)
	st, err := store.OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{AppSecret: "super-secret-long-enough-16", AuthMode: config.AuthDev,
		AdminEmails: map[string]bool{"admin@x.id": true}, TZ: "Asia/Makassar"}
	return NewServer(cfg, st, provs), st
}

func upcomingItems(t *testing.T, srv *Server, query string) []UpcomingItem {
	t.Helper()
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming"+query, "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatalf("upcoming: %d %s", w.Code, w.Body.String())
	}
	var got struct {
		Items []UpcomingItem `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	return got.Items
}

func firstHoliday(items []UpcomingItem) *UpcomingItem {
	for i := range items {
		if items[i].Kind == "holiday" {
			return &items[i]
		}
	}
	return nil
}

// Holidays must carry their effective reminder offsets: the global defaults
// when the category has no override, with reminders_default=true.
func TestUpcomingHolidayRemindersDefault(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Makassar")
	today := domain.DateFromTime(time.Now().In(loc))
	prov := stubProv{name: "fake-national", cat: "national", hs: []domain.Holiday{
		{Date: today.AddDays(10), Name: "Hari Raya Natal", Category: "national"},
	}}
	srv, _ := newUpcomingTestServer(t, []calendarprov.Provider{prov})

	hol := firstHoliday(upcomingItems(t, srv, "?days=30"))
	if hol == nil {
		t.Fatal("no holiday item in /upcoming")
	}
	if !hol.RemindersDefault {
		t.Errorf("reminders_default = %v, want true (no category override)", hol.RemindersDefault)
	}
	if !reflect.DeepEqual(hol.Reminders, domain.DefaultOffsets) {
		t.Errorf("reminders = %v, want %v", hol.Reminders, domain.DefaultOffsets)
	}
}

// A per-category override replaces the defaults: reminders = the override,
// reminders_default=false (field omitted via omitempty).
func TestUpcomingHolidayRemindersCustom(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Makassar")
	today := domain.DateFromTime(time.Now().In(loc))
	prov := stubProv{name: "fake-national", cat: "national", hs: []domain.Holiday{
		{Date: today.AddDays(10), Name: "Hari Raya Natal", Category: "national"},
	}}
	srv, _ := newUpcomingTestServer(t, []calendarprov.Provider{prov})

	body := `{"timezone":"Asia/Makassar","send_time":"08:00","catch_up_hours":24,` +
		`"default_offsets":[7,4,2,1,0],` +
		`"holiday_categories":{"pawukon":true,"saka":true,"national":true},` +
		`"holiday_offsets":{"national":[3,1]}}`
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id", body))
	if w.Code != 200 {
		t.Fatalf("settings PUT: %d %s", w.Code, w.Body.String())
	}

	hol := firstHoliday(upcomingItems(t, srv, "?days=30"))
	if hol == nil {
		t.Fatal("no holiday item in /upcoming")
	}
	if !reflect.DeepEqual(hol.Reminders, []int{3, 1}) {
		t.Errorf("reminders = %v, want [3 1]", hol.Reminders)
	}
	if hol.RemindersDefault {
		t.Error("reminders_default must be false when a category override exists")
	}
}

// Occasions: no prefs → default offsets with reminders_default=true; prefs
// offsets → those offsets with reminders_default=false.
func TestUpcomingOccasionRemindersFlag(t *testing.T) {
	srv, st := newUpcomingTestServer(t, nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts", "admin@x.id",
		`{"name":"Made","nickname":"De"}`))
	if w.Code != 201 {
		t.Fatalf("create contact: %d %s", w.Code, w.Body.String())
	}
	loc, _ := time.LoadLocation("Asia/Makassar")
	today := domain.DateFromTime(time.Now().In(loc))
	ocBody, _ := json.Marshal(map[string]string{"type": "otonan", "date": today.AddDays(-domain.PawukonCycleDays).String()})
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts/1/occasions", "admin@x.id", string(ocBody)))
	if w.Code != 201 {
		t.Fatalf("add occasion: %d %s", w.Code, w.Body.String())
	}

	occ := func(items []UpcomingItem) *UpcomingItem {
		for i := range items {
			if items[i].Kind == "occasion" {
				return &items[i]
			}
		}
		return nil
	}

	items := upcomingItems(t, srv, "?days=30")
	o := occ(items)
	if o == nil {
		t.Fatal("no occasion item in /upcoming")
	}
	if !o.RemindersDefault || !reflect.DeepEqual(o.Reminders, domain.DefaultOffsets) {
		t.Errorf("default case: default=%v reminders=%v, want true/%v",
			o.RemindersDefault, o.Reminders, domain.DefaultOffsets)
	}

	ctx := context.Background()
	if err := st.SetReminderPrefs(ctx, store.ReminderPrefs{
		ContactID: 1, Enabled: true, Offsets: []int{2, 0},
	}); err != nil {
		t.Fatal(err)
	}
	o = occ(upcomingItems(t, srv, "?days=30"))
	if o == nil {
		t.Fatal("no occasion item after prefs")
	}
	if o.RemindersDefault {
		t.Error("reminders_default must be false with prefs offsets")
	}
	if !reflect.DeepEqual(o.Reminders, []int{2, 0}) {
		t.Errorf("reminders = %v, want [2 0]", o.Reminders)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/api/ -run 'TestUpcoming.*Reminders' -v`
Expected: FAIL to compile — `UpcomingItem.RemindersDefault` undefined.

- [ ] **Step 3: Implement**

In `internal/api/upcoming.go`:

1. Struct (line 15): add the flag under `Reminders`:

```go
type UpcomingItem struct {
	Date        domain.Date `json:"date"`
	Kind        string      `json:"kind"` // "occasion" | "holiday"
	OccasionID  int64       `json:"occasion_id,omitempty"`
	ContactID   int64       `json:"contact_id,omitempty"`
	ContactName string      `json:"contact_name,omitempty"`
	Type        string      `json:"type,omitempty"`
	Number      int         `json:"number,omitempty"`
	Title       string      `json:"title"`
	Pawukon     string      `json:"pawukon,omitempty"`
	DaysUntil   int         `json:"days_until"`
	Reminders   []int       `json:"reminders,omitempty"`
	// RemindersDefault: the offsets above came from the global default_offsets
	// fallback (no per-contact prefs / per-category override).
	RemindersDefault bool `json:"reminders_default,omitempty"`
}
```

2. Occasion loop (line 88): compute the flag from prefs, as `remindersDefault := !(cw.Prefs != nil && cw.Prefs.Enabled && len(cw.Prefs.Offsets) > 0)`:

```go
	for _, cw := range contacts {
		offsets := settings.DefaultOffsets
		remindersDefault := !(cw.Prefs != nil && cw.Prefs.Enabled && len(cw.Prefs.Offsets) > 0)
		if !remindersDefault {
			offsets = cw.Prefs.Offsets
		}
		for _, occ := range cw.Occasions {
```

and set the field on the item:

```go
				item := UpcomingItem{
					Date: o.Date, Kind: "occasion", OccasionID: occ.ID, ContactID: cw.ID,
					ContactName: cw.Name, Type: string(o.Type), Number: o.Number,
					Title: o.Label, DaysUntil: o.Date.JDN() - today.JDN(), Reminders: offsets,
					RemindersDefault: remindersDefault,
				}
```

3. Holiday loop (line 117): resolve per-category with the same fallback the scheduler uses:

```go
	for _, h := range hs {
		// Same resolution as the scheduler: per-category offsets, global
		// default fallback (an empty Category also lands on the fallback).
		offs := settings.HolidayOffsets[h.Category]
		remindersDefault := len(offs) == 0
		if remindersDefault {
			offs = settings.DefaultOffsets
		}
		items = append(items, UpcomingItem{Date: h.Date, Kind: "holiday",
			Title: h.Name, DaysUntil: h.Date.JDN() - today.JDN(),
			Reminders: offs, RemindersDefault: remindersDefault})
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/api/ -v`
Expected: PASS (new tests + all existing API tests).

- [ ] **Step 5: Commit**

```bash
git add internal/api/upcoming.go internal/api/upcoming_test.go
git commit -m "feat(api): resolve effective reminders and reminders_default flag in /upcoming"
```

---

### Task 5: Frontend — `Default (D-7, D-4, …)` in the detail surfaces

**Files:**
- Modify: `web/src/lib/api.ts:34-39` (type)
- Modify: `web/src/components/event-detail.tsx:31-66` (`EventDetailRows` Reminders row)

**Interfaces:**
- Consumes: `UpcomingItem` JSON `reminders_default` (bool, present only when true) and `reminders` from Task 4.
- Produces: nothing downstream — `EventDetailRows` is the shared render point for the below-lg `EventDetailDialog` (via `EventDetailBody`) and the lg `AgendaPanel` detail layer; both pick this up automatically. The dashboard list (`reminder.index.tsx`) keeps plain badges, untouched.

- [ ] **Step 1: Extend the `UpcomingItem` type**

In `web/src/lib/api.ts`, replace the interface with:

```ts
export interface UpcomingItem {
  date: string; kind: 'occasion' | 'holiday'
  occasion_id?: number; contact_id?: number; contact_name?: string
  type?: string; number?: number
  title: string; pawukon?: string; days_until: number
  reminders?: number[]; reminders_default?: boolean
}
```

- [ ] **Step 2: Render `Default (…)` vs badges**

In `web/src/components/event-detail.tsx`, add above `EventDetailRows`:

```tsx
/**
 * "Reminders" value: items inheriting the global defaults read
 * "Default (D-7, D-4, …)" Google-Calendar style; custom prefs or per-category
 * holiday offsets render as D-N badges. Empty → em dash.
 */
function RemindersValue({ item }: { item: UpcomingItem }) {
  if (!item.reminders?.length) return <>—</>
  if (item.reminders_default) {
    const offs = [...item.reminders].sort((a, b) => b - a)
    return (
      <span>
        <span className="font-medium">Default</span>
        <span className="text-muted-foreground"> ({offs.map((r) => `D-${r}`).join(', ')})</span>
      </span>
    )
  }
  return (
    <>
      {item.reminders.map((r) => (
        <Badge key={r} variant="secondary" className="me-1">
          D-{r}
        </Badge>
      ))}
    </>
  )
}
```

Then replace the `Reminders` `DetailRow` inside `EventDetailRows` with:

```tsx
      <DetailRow label="Reminders">
        <RemindersValue item={item} />
      </DetailRow>
```

- [ ] **Step 3: Lint and typecheck/build**

Run: `cd web && pnpm lint && pnpm build`
Expected: no lint errors, `tsc -b` + vite build succeed.

- [ ] **Step 4: Run the full verification suite**

```bash
go test ./... && go vet ./...
```

Expected: PASS, no vet findings.

- [ ] **Step 5: Manual smoke (optional but recommended)**

With the server running (`go run ./cmd/server`): open the dashboard, click a pawukon holiday → detail (dialog below-lg, right panel at lg) shows `Default (D-7, D-4, D-2, D-1, D-0)`; a contact with custom prefs shows badges. National holidays appear after the first successful fetch (needs network) — verify at least that `/api/v1/upcoming` no longer errors and pawukon items flow. Note: `D-0` renders for offset 0 (same convention as the existing badges).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/api.ts web/src/components/event-detail.tsx
git commit -m "fix(web): show Default (D-…) reminders for holidays and default-inheriting items in detail surfaces"
```
