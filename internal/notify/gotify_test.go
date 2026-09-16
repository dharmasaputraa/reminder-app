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
	if err := g.Send(context.Background(), Message{Title: "title", Body: "body", Priority: 8}); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/message" {
		t.Errorf("path = %q", gotPath)
	}
	if !strings.Contains(gotQuery, "token=abc123") {
		t.Errorf("query = %q", gotQuery)
	}
	if !strings.Contains(gotBody, `"title":"title"`) || !strings.Contains(gotBody, `"priority":8`) {
		t.Errorf("body = %q", gotBody)
	}
}

func TestGotifyNormalizesBaseURL(t *testing.T) {
	cases := []struct{ in, want string }{
		{"gotify.wiwara.web.id", "https://gotify.wiwara.web.id"},
		{"gotify.wiwara.web.id/", "https://gotify.wiwara.web.id"},
		{"http://192.168.1.10", "http://192.168.1.10"},
		{"https://gotify.example.com", "https://gotify.example.com"},
	}
	for _, tc := range cases {
		g := NewGotify(GotifyConfig{BaseURL: tc.in, Token: "t"})
		if g.cfg.BaseURL != tc.want {
			t.Errorf("BaseURL %q: got %q, want %q", tc.in, g.cfg.BaseURL, tc.want)
		}
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
		t.Errorf("err = %v, must be 401", err)
	}
}

func TestGotifyPriorityFallback(t *testing.T) {
	cases := []struct {
		name        string
		cfgPriority int
		wantBody    string
	}{
		{"empty cfg, default 5", 0, `"priority":5`},
		{"cfg 9, msg 0", 9, `"priority":9`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotBody string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				gotBody = string(b)
				w.WriteHeader(200)
			}))
			defer srv.Close()

			g := NewGotify(GotifyConfig{BaseURL: srv.URL, Token: "t", Priority: tc.cfgPriority})
			if err := g.Send(context.Background(), Message{Title: "x"}); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(gotBody, tc.wantBody) {
				t.Errorf("body = %q, want %s", gotBody, tc.wantBody)
			}
		})
	}
}
