package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestChannelTestSend(t *testing.T) {
	var gotPost bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPost = r.Method == http.MethodPost
		w.WriteHeader(200)
	}))
	defer srv.Close()

	// note: newTestServer also returns *store.Store; not used here.
	s, _ := newTestServer(t, "admin@x.id")
	chID := createChannel(t, s, "admin@x.id",
		`{"type":"gotify","name":"home","config":{"base_url":"`+srv.URL+`","token":"t"}}`)

	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/"+chID+"/test", "admin@x.id", ""))
	if w.Code != 200 || !gotPost {
		t.Errorf("test send: %d %s", w.Code, w.Body.String())
	}

	// channel does not exist → 404
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/"+uuid.NewString()+"/test", "admin@x.id", ""))
	if w.Code != 404 {
		t.Errorf("missing channel: %d", w.Code)
	}
	// malformed id can never exist → 404 (not 400)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/1/test", "admin@x.id", ""))
	if w.Code != 404 {
		t.Errorf("malformed channel id: %d", w.Code)
	}
}
