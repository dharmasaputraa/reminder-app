package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
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
	body := `{"type":"gotify","name":"home","config":{"base_url":"` + srv.URL + `","token":"t"}}`
	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels", "admin@x.id", body))
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/1/test", "admin@x.id", ""))
	if w.Code != 200 || !gotPost {
		t.Errorf("test send: %d %s", w.Code, w.Body.String())
	}

	// channel does not exist → 404
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/999/test", "admin@x.id", ""))
	if w.Code != 404 {
		t.Errorf("missing channel: %d", w.Code)
	}
}
