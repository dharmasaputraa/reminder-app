package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// The test server pins TZ=Asia/Makassar (UTC+8, no DST); occasion dates are
// pinned to it so "today" matches on both sides of the API.
func makassarToday() string {
	return time.Now().In(time.FixedZone("makassar", 8*3600)).Format("2006-01-02")
}

func TestUpcomingNotify(t *testing.T) {
	var bodies []string
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		w.WriteHeader(200)
	}))
	defer hook.Close()

	s, _ := newTestServer(t, "admin@x.id")
	today := makassarToday()

	// Contact with a birthday occurrence TODAY (base date = today → deterministic).
	cid := createContact(t, s, "admin@x.id", `{"name":"Made"}`)
	occID := addOccasion(t, s, "admin@x.id", cid,
		`{"type":"birthday","date":"`+today+`","label":"bday"}`)

	// Two enabled channels + one disabled, all pointing at the hook. Ids are
	// opaque UUIDs, so they are collected from the create responses.
	var chIDs []string
	for _, name := range []string{"a", "b", "off"} {
		chIDs = append(chIDs, createChannel(t, s, "admin@x.id",
			`{"type":"gotify","name":"`+name+`","config":{"base_url":"`+hook.URL+`","token":"t"}}`))
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "PATCH", "/api/v1/channels/"+chIDs[2], "admin@x.id", `{"enabled":false}`))
	if w.Code != 200 {
		t.Fatalf("disable channel: %d %s", w.Code, w.Body.String())
	}

	notifyBody := `{"kind":"occasion","occasion_id":"` + occID + `","contact_id":"` + cid + `","date":"` + today + `","title":"bday"}`

	// No channel_ids → every ENABLED channel of the caller (2), disabled skipped.
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id", notifyBody))
	if w.Code != 200 {
		t.Fatalf("notify all: %d %s", w.Code, w.Body.String())
	}
	var res struct{ Sent, Failed int }
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Sent != 2 || res.Failed != 0 {
		t.Errorf("notify all: sent=%d failed=%d", res.Sent, res.Failed)
	}
	if len(bodies) != 2 || !strings.Contains(bodies[0], "Made") {
		t.Errorf("expected 2 pushes mentioning the contact name, got %v", bodies)
	}

	// Explicit channel_ids narrows to that one channel.
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"occasion","occasion_id":"`+occID+`","contact_id":"`+cid+`","date":"`+today+`","channel_ids":["`+chIDs[1]+`"]}`))
	if w.Code != 200 {
		t.Fatalf("notify one: %d %s", w.Code, w.Body.String())
	}
	if len(bodies) != 3 {
		t.Errorf("expected exactly one more push, got %d total", len(bodies))
	}

	// Unknown channel id → nothing matches → 400.
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"occasion","occasion_id":"`+occID+`","contact_id":"`+cid+`","date":"`+today+`","channel_ids":["`+uuid.NewString()+`"]}`))
	if w.Code != 400 {
		t.Errorf("unknown channel: %d %s", w.Code, w.Body.String())
	}

	// Holiday without providers → 404, not a 500.
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"holiday","title":"Nyepi","date":"`+today+`"}`))
	if w.Code != 404 {
		t.Errorf("holiday without provider: %d %s", w.Code, w.Body.String())
	}

	// Bad kind → 400.
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"nope","date":"`+today+`"}`))
	if w.Code != 400 {
		t.Errorf("bad kind: %d", w.Code)
	}

	// Occasion on another contact → 404.
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"occasion","occasion_id":"`+occID+`","contact_id":"`+uuid.NewString()+`","date":"`+today+`"}`))
	if w.Code != 404 {
		t.Errorf("missing contact: %d", w.Code)
	}

	// Missing ids → 400 (empty strings are the "not provided" signal, not 0).
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"occasion","date":"`+today+`"}`))
	if w.Code != 400 {
		t.Errorf("missing occasion/contact id: %d %s", w.Code, w.Body.String())
	}
}

func TestUpcomingNotifySendFailure(t *testing.T) {
	// Closed port → the push fails → 502 with the last error.
	s, _ := newTestServer(t, "admin@x.id")
	today := makassarToday()

	cid := createContact(t, s, "admin@x.id", `{"name":"Made"}`)
	occID := addOccasion(t, s, "admin@x.id", cid,
		`{"type":"birthday","date":"`+today+`","label":"bday"}`)
	createChannel(t, s, "admin@x.id",
		`{"type":"gotify","name":"dead","config":{"base_url":"http://127.0.0.1:1","token":"t"}}`)

	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/upcoming/notify", "admin@x.id",
		`{"kind":"occasion","occasion_id":"`+occID+`","contact_id":"`+cid+`","date":"`+today+`"}`))
	if w.Code != 502 {
		t.Errorf("dead channel: %d %s", w.Code, w.Body.String())
	}
}
