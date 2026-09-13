package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// withSpaFS swaps the embedded FS for a test FS so results do not depend on
// whether the `make web` output exists in internal/api/webroot (gitignored).
func withSpaFS(t *testing.T, fsys fstest.MapFS) {
	t.Helper()
	old := spaFS
	spaFS = fsys
	t.Cleanup(func() { spaFS = old })
}

func TestSPANotBuiltReturns503(t *testing.T) {
	withSpaFS(t, fstest.MapFS{})
	s, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 {
		t.Errorf("/ tanpa build webroot: %d, want 503", w.Code)
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/tidak-ada", nil))
	if w.Code != 404 {
		t.Errorf("/api/* tidak dikenal: %d, want 404", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "json") {
		t.Errorf("/api/* tidak dikenal content-type: %q, want JSON", ct)
	}
}

func TestSPAWithBuiltWebroot(t *testing.T) {
	withSpaFS(t, fstest.MapFS{
		"webroot/index.html":           &fstest.MapFile{Data: []byte(`<div id="root"></div>`)},
		"webroot/assets/app.js":        &fstest.MapFile{Data: []byte("console.log(1)")},
		"webroot/manifest.webmanifest": &fstest.MapFile{Data: []byte(`{"name":"otorem"}`)},
		"webroot/sw.js":                &fstest.MapFile{Data: []byte("self.addEventListener")},
	})
	s, _ := newTestServer(t, "admin@x.id")
	cases := []struct {
		path, body, ct string
		code           int
	}{
		{"/", `<div id="root">`, "text/html", 200},
		{"/contacts/1", `<div id="root">`, "text/html", 200}, // SPA fallback
		{"/assets/app.js", "console.log(1)", "text/javascript", 200},
		{"/manifest.webmanifest", `"name":"otorem"`, "application/manifest+json", 200},
		{"/sw.js", "addEventListener", "text/javascript", 200},
		{"/../go.mod", `<div id="root">`, "text/html", 200}, // traversal outside webroot → fallback
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.code {
			t.Errorf("GET %s: %d, want %d", tc.path, w.Code, tc.code)
		}
		if got := w.Body.String(); !strings.Contains(got, tc.body) {
			t.Errorf("GET %s body %q tidak memuat %q", tc.path, got, tc.body)
		}
		if got := w.Header().Get("Content-Type"); !strings.Contains(got, tc.ct) {
			t.Errorf("GET %s content-type %q tidak memuat %q", tc.path, got, tc.ct)
		}
	}
}
