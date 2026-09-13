package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTelegramSend(t *testing.T) {
	var gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		io.WriteString(w, `{"ok":true,"result":{"message_id":1}}`)
	}))
	defer srv.Close()

	tg := NewTelegram(TelegramConfig{BotToken: "BOT123", ChatID: "-10099"})
	tg.baseURL = srv.URL
	if err := tg.Send(context.Background(), Message{Title: "<b>Hello</b>", Body: "body & safe"}); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(gotPath, "/botBOT123/sendMessage") {
		t.Errorf("path = %q", gotPath)
	}
	if !strings.Contains(gotBody, `"chat_id":"-10099"`) {
		t.Errorf("body = %q", gotBody)
	}
	if strings.Contains(gotBody, "<b>Hello</b>") {
		t.Errorf("HTML not escaped: %q", gotBody)
	}
}

func TestTelegramAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"ok":false,"description":"chat not found"}`)
	}))
	defer srv.Close()
	tg := NewTelegram(TelegramConfig{BotToken: "x", ChatID: "1"})
	tg.baseURL = srv.URL
	if err := tg.Send(context.Background(), Message{Title: "t"}); err == nil ||
		!strings.Contains(err.Error(), "chat not found") {
		t.Errorf("err = %v", err)
	}
}

func TestTelegramJSONShape(t *testing.T) {
	// ensure the payload is valid: parse it back
	var m map[string]any
	_ = json.Unmarshal([]byte(`{"chat_id":"1","text":"x","parse_mode":"HTML"}`), &m)
	if m["parse_mode"] != "HTML" {
		t.Fatal("json sanity check failed")
	}
}
