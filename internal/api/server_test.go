package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"wimember/internal/config"
	"wimember/internal/domain"
	"wimember/internal/store"
)

func newTestServer(t *testing.T, admin string) (*Server, *store.Store) {
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
		AdminEmails: map[string]bool{admin: true}, TZ: "Asia/Makassar"}
	return NewServer(cfg, st, nil), st
}

func ginSet(t *testing.T) { gin.SetMode(gin.TestMode) } // via import gin

// createContact posts a contact and returns its id. Ids are opaque UUID
// strings now, so tests read the id back from the response instead of
// assuming "1".
func createContact(t *testing.T, srv *Server, email, body string) string {
	t.Helper()
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts", email, body))
	if w.Code != 201 {
		t.Fatalf("create contact: %d %s", w.Code, w.Body.String())
	}
	var c store.Contact
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	if c.ID == "" {
		t.Fatalf("created contact has no id: %s", w.Body.String())
	}
	return c.ID
}

// addOccasion posts an occasion on a contact and returns its id.
func addOccasion(t *testing.T, srv *Server, email, contactID, body string) string {
	t.Helper()
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts/"+contactID+"/occasions", email, body))
	if w.Code != 201 {
		t.Fatalf("add occasion: %d %s", w.Code, w.Body.String())
	}
	var oc store.Occasion
	if err := json.Unmarshal(w.Body.Bytes(), &oc); err != nil {
		t.Fatal(err)
	}
	if oc.ID == "" {
		t.Fatalf("created occasion has no id: %s", w.Body.String())
	}
	return oc.ID
}

// createChannel posts a channel and returns its id.
func createChannel(t *testing.T, srv *Server, email, body string) string {
	t.Helper()
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels", email, body))
	if w.Code != 201 {
		t.Fatalf("create channel: %d %s", w.Code, w.Body.String())
	}
	var ch struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &ch); err != nil {
		t.Fatal(err)
	}
	if ch.ID == "" {
		t.Fatalf("created channel has no id: %s", w.Body.String())
	}
	return ch.ID
}

func devReq(t *testing.T, method, target, email, body string) *http.Request {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Dev-Email", email)
	return req
}

func TestContactFlow(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	cid := createContact(t, srv, "admin@x.id", `{"name":"Made","nickname":"De","notes":"cousin"}`)

	// Otonan base = today − 210 → the 1st occurrence falls EXACTLY today; deterministic
	// for the 30-day window (random dates often fall outside the window → flaky).
	// Pin to the server TZ (Asia/Makassar, matching DefaultSettings) — not the machine TZ —
	// so it is deterministic in all time zones.
	loc, _ := time.LoadLocation("Asia/Makassar")
	today := domain.DateFromTime(time.Now().In(loc))
	base := today.AddDays(-domain.PawukonCycleDays)
	ocBody, _ := json.Marshal(map[string]string{"type": "otonan", "date": base.String()})
	addOccasion(t, srv, "admin@x.id", cid, string(ocBody))

	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming?days=30", "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatalf("upcoming: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"kind":"occasion"`) || !strings.Contains(w.Body.String(), `"pawukon"`) {
		t.Errorf("upcoming does not contain occasion+pawukon: %s", w.Body.String())
	}
}

func TestContactJSONSnakeCase(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts", "admin@x.id",
		`{"name":"Made","nickname":"De","notes":"cousin"}`))
	if w.Code != 201 {
		t.Fatalf("create contact: %d %s", w.Code, w.Body.String())
	}
	created := w.Body.String()
	for _, want := range []string{`"occasions":[]`, `"prefs":null`} {
		if !strings.Contains(created, want) {
			t.Errorf("create contact response does not contain %s: %s", want, created)
		}
	}
	var ct store.Contact
	if err := json.Unmarshal(w.Body.Bytes(), &ct); err != nil {
		t.Fatal(err)
	}
	addOccasion(t, srv, "admin@x.id", ct.ID, `{"type":"otonan","date":"1990-05-12"}`)

	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/contacts/"+ct.ID, "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatalf("get contact: %d %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, want := range []string{`"name":`, `"occasions"`, `"base_date"`, `"contact_id"`, `"prefs":null`} {
		if !strings.Contains(body, want) {
			t.Errorf("contact response does not contain %s: %s", want, body)
		}
	}
	for _, bad := range []string{`"OwnerID"`, `"BaseDate"`} {
		if strings.Contains(body, bad) {
			t.Errorf("contact response is still PascalCase %s: %s", bad, body)
		}
	}
}

func TestUpcomingEmpty(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming", "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var out struct {
		Items []UpcomingItem `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	// may be empty or contain pawukon holidays; must not error
	_ = out
}

func TestPawukonEndpoint(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/pawukon?date=2026-06-17", "admin@x.id", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Buda Kliwon, Wuku Dunggulan") {
		t.Errorf("pawukon: %d %s", w.Code, w.Body.String())
	}
}

func TestChannelConfigNeverLeaked(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels", "admin@x.id",
		`{"type":"gotify","name":"home","config":{"base_url":"https://g.x.id","token":"SECRET-TOKEN"}}`))
	if w.Code != 201 {
		t.Fatalf("create channel: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/channels", "admin@x.id", ""))
	if strings.Contains(w.Body.String(), "SECRET-TOKEN") {
		t.Error("channel config leaked in the response!")
	}
}

func TestSettingsValidate(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id",
		`{"timezone":"Asia/Makassar","send_time":"07:30","catch_up_hours":12,"default_offsets":[3,1,0],"holiday_categories":{"pawukon":true}}`))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"catch_up_hours":12`) {
		t.Errorf("save settings: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id",
		`{"timezone":"Not/AZone","send_time":"07:30","catch_up_hours":12,"default_offsets":[1],"holiday_categories":{}}`))
	if w.Code != 400 {
		t.Errorf("invalid tz must be 400: %d", w.Code)
	}
}

func TestSettingsMissingCategories(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	// PUT without holiday_categories → 200 (no panic), all three categories filled
	// per the brief's semantics: a category that is not sent → false.
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id",
		`{"timezone":"Asia/Jakarta","send_time":"08:00","catch_up_hours":24,"default_offsets":[7,4,2,1,0]}`))
	if w.Code != 200 {
		t.Fatalf("put without holiday_categories: %d %s", w.Code, w.Body.String())
	}
	var got Settings
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	for _, cat := range []string{"pawukon", "saka", "national"} {
		v, ok := got.HolidayCategories[cat]
		if !ok {
			t.Errorf("category %q missing from response", cat)
		} else if v {
			t.Errorf("category %q must be false (not sent), got %v", cat, v)
		}
	}
}

func TestAddOccasionInvalidType(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	cid := createContact(t, srv, "admin@x.id", `{"name":"Made"}`)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts/"+cid+"/occasions", "admin@x.id",
		`{"type":"bogus","date":"1990-05-12"}`))
	if w.Code != 400 {
		t.Errorf("illegal occasion type must be 400, got %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "invalid occasion type") {
		t.Errorf("wrong error message: %s", w.Body.String())
	}
}

func TestDefaultSettingsDefensiveCopy(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	ds := DefaultSettings()
	ds.DefaultOffsets[0] = 99
	ls := srv.LoadSettings(context.Background())
	ls.DefaultOffsets[0] = 99
	if domain.DefaultOffsets[0] != 7 {
		t.Errorf("domain.DefaultOffsets mutated via api.Settings: %v", domain.DefaultOffsets)
	}
}

func TestSchedulerRunWithoutRunner(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "admin@x.id", ""))
	if w.Code != 503 {
		t.Errorf("without runner: %d", w.Code)
	}
	_ = context.Background()
}

// offsets:[] is a RESET signal to the global default (not "keep the old value"):
// handleSetPrefs turns the flat list into the per-stream map — [] → an empty map
// ({}), not null/dropped, so the reset is PERSISTED. Consumers —
// internal/api/upcoming.go and internal/scheduler/scheduler.go — treat a map
// without any list as "use the global defaults"; this test locks down both
// sides of that contract. Task 8 flips the wire shape to the map itself.
func TestPrefsOffsetsResetToDefault(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	cid := createContact(t, srv, "admin@x.id", `{"name":"Made"}`)

	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/contacts/"+cid+"/prefs", "admin@x.id",
		`{"offsets":[],"channel_ids":[],"enabled":true}`))
	if w.Code != 200 {
		t.Fatalf("put prefs with empty offsets: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/contacts/"+cid, "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatalf("get contact: %d %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	var got store.ContactWithOccasions
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Prefs == nil {
		t.Fatalf("prefs missing after reset: %s", body)
	}
	if !got.Prefs.Enabled {
		t.Errorf("enabled must stay true: %+v", *got.Prefs)
	}
	if len(got.Prefs.Offsets) != 0 {
		t.Errorf("offsets must be empty (reset to default), got %v", got.Prefs.Offsets)
	}
	if !strings.Contains(body, `"offsets":{}`) {
		t.Errorf(`prefs must contain "offsets":{} (not null/missing): %s`, body)
	}

	// Consumer side: an otonan occurrence exactly today (base = today − 210) must
	// use the global default reminders because prefs.offsets is empty.
	loc, _ := time.LoadLocation("Asia/Makassar")
	today := domain.DateFromTime(time.Now().In(loc))
	ocBody, _ := json.Marshal(map[string]string{"type": "otonan", "date": today.AddDays(-domain.PawukonCycleDays).String()})
	addOccasion(t, srv, "admin@x.id", cid, string(ocBody))
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming?days=30", "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatalf("upcoming: %d %s", w.Code, w.Body.String())
	}
	var up struct {
		Items []UpcomingItem `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &up); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, it := range up.Items {
		if it.Kind == "occasion" && it.ContactID == cid {
			found = true
			if !reflect.DeepEqual(it.Reminders, domain.DefaultOffsets) {
				t.Errorf("reminders must be the global default %v, got %v", domain.DefaultOffsets, it.Reminders)
			}
		}
	}
	if !found {
		t.Errorf("contact occasion did not appear in /upcoming: %s", w.Body.String())
	}
}

// The old flat offsets list is stored under every stream while the wire shape
// is still flat (Task 8 switches it to the per-stream map): a contact override
// keeps applying to all of its reminders.
func TestSetPrefsLegacyFlatOffsets(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	cid := createContact(t, srv, "admin@x.id", `{"name":"Made"}`)

	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/contacts/"+cid+"/prefs", "admin@x.id",
		`{"offsets":[3,1,0],"enabled":true}`))
	if w.Code != 200 {
		t.Fatalf("put prefs: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Offsets domain.OffsetMap `json:"offsets"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	for _, s := range allStreams {
		if !reflect.DeepEqual(out.Offsets[s], []int{3, 1, 0}) {
			t.Errorf("offsets[%s] = %v, want [3 1 0] (flat list applies to every stream)", s, out.Offsets[s])
		}
	}
	// An invalid offset is still rejected (validation runs on the mapped value).
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/contacts/"+cid+"/prefs", "admin@x.id",
		`{"offsets":[61],"enabled":true}`))
	if w.Code != 400 {
		t.Errorf("offset 61 must be 400, got %d %s", w.Code, w.Body.String())
	}
}

func TestUpcomingDateRange(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	cid := createContact(t, srv, "admin@x.id", `{"name":"Made"}`)
	addOccasion(t, srv, "admin@x.id", cid, `{"type":"birthday","date":"2003-06-03"}`)

	get := func(query string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming"+query, "admin@x.id", ""))
		return w
	}
	hasBirthday := func(w *httptest.ResponseRecorder) bool {
		if w.Code != 200 {
			t.Fatalf("upcoming: %d %s", w.Code, w.Body.String())
		}
		var up struct {
			Items []UpcomingItem `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &up); err != nil {
			t.Fatal(err)
		}
		for _, it := range up.Items {
			if it.Kind == "occasion" && it.Type == "birthday" && it.Date.String() == "2027-06-03" {
				return true
			}
		}
		return false
	}

	// Full year: the June 3, 2027 birthday must appear even though it falls
	// far outside the 30-day window from today.
	if w := get("?from=2027-01-01&to=2027-12-31"); !hasBirthday(w) {
		t.Errorf("birthday 2027-06-03 missing from the one-year range: %s", w.Body.String())
	}
	// `to` is optional: defaults to one year from `from`.
	if w := get("?from=2027-06-01"); !hasBirthday(w) {
		t.Errorf("birthday 2027-06-03 missing from from without to: %s", w.Body.String())
	}
	// Reversed range → 400.
	if w := get("?from=2027-12-31&to=2027-01-01"); w.Code != 400 {
		t.Errorf("inverted range must be 400, got %d", w.Code)
	}
	// Range > 400 days → 400.
	if w := get("?from=2027-01-01&to=2028-03-01"); w.Code != 400 {
		t.Errorf("range >400 days must be 400, got %d", w.Code)
	}
	// from is not a date → 400.
	if w := get("?from=not-a-date"); w.Code != 400 {
		t.Errorf("invalid from must be 400, got %d", w.Code)
	}
}
