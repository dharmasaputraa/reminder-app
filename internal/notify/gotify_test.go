package notify

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGotifySend(t *testing.T) {
	var gotPath, gotQuery, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	g := NewGotify(GotifyConfig{BaseURL: srv.URL, Token: "abc123"})
	if err := g.Send(context.Background(), Message{Title: "judul", Body: "isi", Priority: 8}); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/message" {
		t.Errorf("path = %q", gotPath)
	}
	if !strings.Contains(gotQuery, "token=abc123") {
		t.Errorf("query = %q", gotQuery)
	}
	if !strings.Contains(gotBody, `"title":"judul"`) || !strings.Contains(gotBody, `"priority":8`) {
		t.Errorf("body = %q", gotBody)
	}
}

func TestGotifyErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		io.WriteString(w, "unauthorized")
	}))
	defer srv.Close()
	g := NewGotify(GotifyConfig{BaseURL: srv.URL, Token: "x"})
	if err := g.Send(context.Background(), Message{Title: "t"}); err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("err = %v, harus 401", err)
	}
}
