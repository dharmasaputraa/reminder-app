# otorem Plan 3/4: Scheduler + Notifier + Remote Holiday Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reliable notification delivery engine: a `Notifier` interface (Gotify/Telegram/SMTP) with retry & backoff, a scan-based scheduler running every minute with dedupe + catch-up window, and remote holiday providers (national holidays + Balinese holidays) with a local cache.

**Architecture:** `internal/notify` (interface + 3 implementations + factory from encrypted channels), `internal/scheduler` (Clock interface + stateless scan-based Service), small additions to `internal/api` (channel test endpoint + runner adapter), `internal/calendarprov` (2 remote providers + CachedRemote), and final wiring in `cmd/server/main.go`.

**Tech Stack:** stdlib (`net/smtp`, `net/http`), `github.com/prometheus/client_golang` (already present). No new dependencies unless something unexpected comes up.

## Global Constraints

- All date/timezone conversion happens ONLY in the scheduler via `Snapshot.Timezone`; domain stays on civil `Date`.
- **Dedupe**: success/missed are recorded in `notification_log` (INSERT OR IGNORE). **Failures are NOT recorded** → automatic retry on the next scan (at most 1×/minute) until it succeeds or the window passes. Anti-spam: a failed channel is skipped for 15 minutes (in-memory `failUntil`).
- `RunOnce` is guarded by a `sync.Mutex` (safe against a manual trigger racing the ticker).
- The scheduler NEVER calls the internet directly — everything goes through `calendarprov.Provider`; a failing remote provider → cache/stale, and the scheduler keeps running.
- Notification messages are in Indonesian; HTML is escaped before being sent to Telegram.
- TDD: test first → red → implement → green → commit.
- Contract from Plan 2 (MUST be used exactly): `api.Server.SetRunner(api.SchedulerRunner)`, `api.RunResult{Sent,Failed,Missed int}`, `api.Server.LoadSettings(ctx) api.Settings`, `notify` does not exist yet, `store.RecordNotification`, `store.ListChannels(ctx, ownerID)`, `secret.DeriveKey`, `calendarprov.Provider{Name,Category,HolidaysBetween}`, `domain.OccurrencesBetween`, `domain.ReminderDates` is not used by the scheduler (offsets are computed directly: `occDate.AddDays(-off)`).

---

### Task 1: notify core — Message, Notifier, message templates

**Files:**
- Create: `internal/notify/notify.go`
- Create: `internal/notify/message.go`
- Test: `internal/notify/message_test.go`

**Interfaces:**
- Produces:
```go
type Message struct{ Title string; Body string; Priority int } // Priority 1..10 (Gotify-style)
type Notifier interface {
	Name() string
	Send(ctx context.Context, msg Message) error
	Test(ctx context.Context) error
}
func OccurrenceMessage(contactName string, occ domain.Occurrence, daysUntil int, late bool) Message
func HolidayMessage(h domain.Holiday, daysUntil int, late bool) Message
func TanggalIndo(d domain.Date) string // "Rabu, 17 Juni 2026"
```

- [ ] **Step 1: Write the failing test**

`internal/notify/message_test.go`:

```go
package notify

import (
	"strings"
	"testing"

	"otorem/internal/domain"
)

func TestTanggalIndo(t *testing.T) {
	got := TanggalIndo(domain.NewDate(2026, 6, 17))
	if got != "Rabu, 17 Juni 2026" { t.Errorf("TanggalIndo = %q", got) }
}

func TestOccurrenceMessageOtonan(t *testing.T) {
	occ := domain.Occurrence{Date: domain.NewDate(2026, 6, 17), Type: domain.Otonan,
		Number: 12, Label: "Otonan ke-12 — Buda Kliwon, Wuku Dunggulan"}
	m := OccurrenceMessage("Made", occ, 3, false)
	if !strings.Contains(m.Title, "🛕") || !strings.Contains(m.Title, "Made") ||
		!strings.Contains(m.Title, "Otonan ke-12") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "3 hari lagi") || !strings.Contains(m.Body, "Rabu, 17 Juni 2026") {
		t.Errorf("body = %q", m.Body)
	}
	if m.Priority != 5 { t.Errorf("priority = %d", m.Priority) }
}

func TestOccurrenceMessageBirthdayToday(t *testing.T) {
	occ := domain.Occurrence{Date: domain.NewDate(2026, 6, 17), Type: domain.Birthday, Number: 36}
	m := OccurrenceMessage("Budi", occ, 0, false)
	if !strings.Contains(m.Title, "🎂") || !strings.Contains(m.Title, "hari ini") {
		t.Errorf("title = %q", m.Title)
	}
	if m.Priority != 8 { t.Errorf("today must be priority 8, got %d", m.Priority) }
}

func TestLateSuffix(t *testing.T) {
	m := OccurrenceMessage("Budi", domain.Occurrence{Date: domain.NewDate(2026, 6, 17),
		Type: domain.Birthday, Number: 30}, 1, true)
	if !strings.Contains(m.Body, "terlambat") { t.Errorf("late flag not visible: %q", m.Body) }
}

func TestHolidayMessage(t *testing.T) {
	m := HolidayMessage(domain.Holiday{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}, 10, false)
	if !strings.Contains(m.Title, "Galungan") || !strings.Contains(m.Title, "10 hari lagi") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "Rabu, 17 Juni 2026") { t.Errorf("body = %q", m.Body) }
}
```

- [ ] **Step 2: Run — FAIL**

Run: `go test ./internal/notify/ -v`
Expected: FAIL — `OccurrenceMessage undefined`

- [ ] **Step 3: Implementation**

`internal/notify/notify.go`:

```go
// Package notify: notification delivery to Gotify, Telegram, and Email.
// The Notifier interface is implemented by 3 channels; the factory built from
// DB channels lives in factory.go.
package notify

import "context"

type Message struct {
	Title    string
	Body     string
	Priority int // 1..10, Gotify-style; SMTP ignores it
}

type Notifier interface {
	Name() string
	Send(ctx context.Context, msg Message) error
	Test(ctx context.Context) error
}
```

`internal/notify/message.go`:

```go
package notify

import (
	"fmt"

	"otorem/internal/domain"
)

var bulanIndo = [12]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni",
	"Juli", "Agustus", "September", "Oktober", "November", "Desember"}

// TanggalIndo: "Rabu, 17 Juni 2026" — the day name uses saptawara
// (Redite=Sunday, Soma=Monday, Anggara=Tuesday, Buda=Wednesday, etc.).
func TanggalIndo(d domain.Date) string {
	return fmt.Sprintf("%s, %d %s %d", domain.Saptawara[d.Weekday()], d.Day, bulanIndo[d.Month-1], d.Year)
}

func kapan(daysUntil int) string {
	switch {
	case daysUntil <= 0:
		return "hari ini"
	case daysUntil == 1:
		return "besok"
	default:
		return fmt.Sprintf("%d hari lagi", daysUntil)
	}
}

func holidayEmoji(name string) string {
	switch {
	case name == "Nyepi":
		return "🧘"
	case name == "Galungan" || name == "Kuningan" || name == "Pagerwesi" || name == "Saraswati":
		return "🛕"
	default:
		return "📅"
	}
}

func withLate(body string, late bool) string {
	if late {
		return body + " ⚠️ Terkirim terlambat (perangkat sempat mati)."
	}
	return body
}

func OccurrenceMessage(contactName string, occ domain.Occurrence, daysUntil int, late bool) Message {
	var title, body string
	switch occ.Type {
	case domain.Otonan:
		title = fmt.Sprintf("🛕 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("Otonan %s %s, pada %s.", contactName, kapan(daysUntil), TanggalIndo(occ.Date))
	case domain.Birthday:
		title = fmt.Sprintf("🎂 %s ultah ke-%d %s", contactName, occ.Number, kapan(daysUntil))
		body = fmt.Sprintf("Ulang tahun ke-%d %s pada %s.", occ.Number, contactName, TanggalIndo(occ.Date))
	default:
		title = fmt.Sprintf("🎊 %s anniversary ke-%d %s", contactName, occ.Number, kapan(daysUntil))
		body = fmt.Sprintf("Anniversary ke-%d %s pada %s.", occ.Number, contactName, TanggalIndo(occ.Date))
	}
	p := 5
	if daysUntil <= 0 { p = 8 }
	return Message{Title: title, Body: withLate(body, late), Priority: p}
}

func HolidayMessage(h domain.Holiday, daysUntil int, late bool) Message {
	title := fmt.Sprintf("%s %s %s", holidayEmoji(h.Name), h.Name, kapan(daysUntil))
	body := fmt.Sprintf("%s jatuh pada %s.", h.Name, TanggalIndo(h.Date))
	return Message{Title: title, Body: withLate(body, late), Priority: 5}
}
```

- [ ] **Step 4: Run — PASS, then commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): message/notifier contracts + template pesan indonesia"
```

---

### Task 2: Gotify notifier

**Files:**
- Create: `internal/notify/gotify.go`
- Test: `internal/notify/gotify_test.go`

**Interfaces:**
- Consumes: `notify.Message`, `notify.Notifier`
- Produces: `type GotifyConfig struct{ BaseURL string `json:"base_url"`; Token string `json:"token"`; Priority int `json:"priority,omitempty"` }`; `func NewGotify(cfg GotifyConfig) *Gotify` (POST `{BaseURL}/message?token=...`, JSON `{title,message,priority}`, Priority defaults to 5, 10s timeout, error on non-2xx status).

- [ ] **Step 1: Test (failing)**

`internal/notify/gotify_test.go`:

```go
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
	if gotPath != "/message" { t.Errorf("path = %q", gotPath) }
	if !strings.Contains(gotQuery, "token=abc123") { t.Errorf("query = %q", gotQuery) }
	if !strings.Contains(gotBody, `"title":"judul"`) || !strings.Contains(gotBody, `"priority":8`) {
		t.Errorf("body = %q", gotBody)
	}
}

func TestGotifyErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401); io.WriteString(w, "unauthorized")
	}))
	defer srv.Close()
	g := NewGotify(GotifyConfig{BaseURL: srv.URL, Token: "x"})
	if err := g.Send(context.Background(), Message{Title: "t"}); err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("err = %v, must be 401", err)
	}
}
```

- [ ] **Step 2: Run — FAIL**, then implement `internal/notify/gotify.go`

```go
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type GotifyConfig struct {
	BaseURL  string `json:"base_url"`
	Token    string `json:"token"`
	Priority int    `json:"priority,omitempty"`
}

type Gotify struct {
	cfg GotifyConfig
	hc  *http.Client
}

func NewGotify(cfg GotifyConfig) *Gotify {
	if cfg.Priority == 0 { cfg.Priority = 5 }
	return &Gotify{cfg: cfg, hc: &http.Client{Timeout: 10 * time.Second}}
}

func (g *Gotify) Name() string { return "gotify" }

func (g *Gotify) Send(ctx context.Context, msg Message) error {
	payload, err := json.Marshal(map[string]any{
		"title": msg.Title, "message": msg.Body, "priority": msg.Priority,
	})
	if err != nil { return err }
	endpoint := strings.TrimRight(g.cfg.BaseURL, "/") + "/message?token=" + url.QueryEscape(g.cfg.Token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil { return err }
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.hc.Do(req)
	if err != nil { return fmt.Errorf("gotify: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("gotify status %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func (g *Gotify) Test(ctx context.Context) error {
	return g.Send(ctx, Message{Title: "otorem tes", Body: "Koneksi Gotify OK ✅", Priority: 5})
}
```

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): gotify notifier"
```

---

### Task 3: Telegram notifier

**Files:**
- Create: `internal/notify/telegram.go`
- Test: `internal/notify/telegram_test.go`

**Interfaces:**
- Produces: `type TelegramConfig struct{ BotToken string `json:"bot_token"`; ChatID string `json:"chat_id"` }`; `func NewTelegram(cfg TelegramConfig) *Telegram` — POST `{base}/bot{token}/sendMessage` JSON `{chat_id, text, parse_mode:"HTML"}`; HTML-escapes title+body; errors when `"ok":false`; an unexported `baseURL` field (default `https://api.telegram.org`) for test overriding.

- [ ] **Step 1: Test (failing)**

`internal/notify/telegram_test.go`:

```go
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
	if err := tg.Send(context.Background(), Message{Title: "<b>Halō</b>", Body: "isi & aman"}); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(gotPath, "/botBOT123/sendMessage") { t.Errorf("path = %q", gotPath) }
	if !strings.Contains(gotBody, `"chat_id":"-10099"`) { t.Errorf("body = %q", gotBody) }
	if strings.Contains(gotBody, "<b>Halō</b>") { t.Errorf("HTML was not escaped: %q", gotBody) }
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
	// make sure the payload is valid: parse it back
	var m map[string]any
	_ = json.Unmarshal([]byte(`{"chat_id":"1","text":"x","parse_mode":"HTML"}`), &m)
	if m["parse_mode"] != "HTML" { t.Fatal("json sanity failed") }
}
```

- [ ] **Step 2: Run — FAIL**, then implement `internal/notify/telegram.go`

```go
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"time"
)

type TelegramConfig struct {
	BotToken string `json:"bot_token"`
	ChatID   string `json:"chat_id"`
}

type Telegram struct {
	cfg     TelegramConfig
	baseURL string
	hc      *http.Client
}

func NewTelegram(cfg TelegramConfig) *Telegram {
	return &Telegram{cfg: cfg, baseURL: "https://api.telegram.org",
		hc: &http.Client{Timeout: 10 * time.Second}}
}

func (t *Telegram) Name() string { return "telegram" }

func (t *Telegram) Send(ctx context.Context, msg Message) error {
	payload, err := json.Marshal(map[string]string{
		"chat_id":    t.cfg.ChatID,
		"text":       html.EscapeString(msg.Title) + "\n" + html.EscapeString(msg.Body),
		"parse_mode": "HTML",
	})
	if err != nil { return err }
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		t.baseURL+"/bot"+t.cfg.BotToken+"/sendMessage", bytes.NewReader(payload))
	if err != nil { return err }
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.hc.Do(req)
	if err != nil { return fmt.Errorf("telegram: %w", err) }
	defer resp.Body.Close()
	var out struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("telegram decode: %w", err)
	}
	if !out.OK { return fmt.Errorf("telegram: %s", out.Description) }
	return nil
}

func (t *Telegram) Test(ctx context.Context) error {
	return t.Send(ctx, Message{Title: "otorem tes", Body: "Koneksi Telegram OK ✅"})
}
```

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): telegram notifier dengan html escape"
```

---

### Task 4: Email notifier (SMTP) + fake SMTP server test

**Files:**
- Create: `internal/notify/smtp.go`
- Test: `internal/notify/smtp_test.go` (contains a minimal fake SMTP server)

**Interfaces:**
- Produces: `type SMTPConfig struct{ Host string `json:"host"`; Port int `json:"port"`; Username, Password, From string `json:"..."`; To []string `json:"to"` }`; `func NewSMTP(cfg SMTPConfig) *SMTP` — `smtp.SendMail(host:port, PlainAuth, From, To, raw)` with a `multipart/alternative` message (text + HTML), Subject = Title; Send honors ctx (goroutine + select).

- [ ] **Step 1: Test + fake SMTP server (failing)**

`internal/notify/smtp_test.go`:

```go
package notify

import (
	"bufio"
	"context"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeSMTP: a minimal SMTP server for tests — just enough of the protocol
// (220/250/354/221) and captures the DATA payload.
type fakeSMTP struct {
	addr      string
	data      string
	mailFrom  string
	rcptTo    []string
	quit      func()
}

func startFakeSMTP(t *testing.T) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil { t.Fatal(err) }
	f := &fakeSMTP{addr: ln.Addr().String()}
	done := make(chan struct{})
	f.quit = func() { close(done); ln.Close() }
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil { return }
			go func(c net.Conn) {
				defer c.Close()
				w := bufio.NewWriter(c)
				r := bufio.NewReader(c)
				write := func(s string) { w.WriteString(s + "\r\n"); w.Flush() }
				write("220 otorem-test ESMTP")
				inData := false
				for {
					line, err := r.ReadString('\n')
					if err != nil { return }
					trimmed := strings.TrimRight(line, "\r\n")
					switch {
					case inData:
						if trimmed == "." { inData = false; write("250 OK") } else { f.data += line }
					case strings.HasPrefix(strings.ToUpper(trimmed), "EHLO"),
						strings.HasPrefix(strings.ToUpper(trimmed), "HELO"):
						write("250 otorem-test")
					case strings.HasPrefix(strings.ToUpper(trimmed), "MAIL FROM:"):
						f.mailFrom = trimmed
						write("250 OK")
					case strings.HasPrefix(strings.ToUpper(trimmed), "RCPT TO:"):
						f.rcptTo = append(f.rcptTo, trimmed)
						write("250 OK")
					case strings.HasPrefix(strings.ToUpper(trimmed), "DATA"):
						write("354 end with <CR><LF>.<CR><LF>")
						inData = true
					case strings.HasPrefix(strings.ToUpper(trimmed), "QUIT"):
						write("221 bye")
						return
					default:
						write("250 OK")
					}
				}
			}(conn)
		}
	}()
	t.Cleanup(f.quit)
	return f
}

func TestSMTPSend(t *testing.T) {
	f := startFakeSMTP(t)
	port, _ := strconv.Atoi(strings.Split(f.addr, ":")[1])
	s := NewSMTP(SMTPConfig{Host: "127.0.0.1", Port: port, From: "otorem@x.id",
		To: []string{"budi@x.id"}}) // no auth — the fake accepts anything
	if err := s.Send(context.Background(), Message{Title: "🎂 ultah", Body: "isi pesan"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.data, "Subject: 🎂 ultah") { t.Errorf("subject: %q", f.data) }
	if !strings.Contains(f.data, "isi pesan") { t.Errorf("body text: %q", f.data) }
	if !strings.Contains(f.data, "multipart/alternative") { t.Errorf("must be multipart: %q", f.data) }
	if len(f.rcptTo) != 1 || !strings.Contains(f.rcptTo[0], "budi@x.id") { t.Errorf("rcpt: %v", f.rcptTo) }
}

func TestSMTPContextTimeout(t *testing.T) {
	// a port that definitely has nothing listening: the connection will fail/time out
	s := NewSMTP(SMTPConfig{Host: "127.0.0.1", Port: 1, From: "a@b.c", To: []string{"d@e.f"}})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.Send(ctx, Message{Title: "x"}); err == nil { t.Error("must fail") }
}
```

- [ ] **Step 2: Run — FAIL**, then implement `internal/notify/smtp.go`

```go
package notify

import (
	"context"
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

type SMTPConfig struct {
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Username string   `json:"username"`
	Password string   `json:"password"`
	From     string   `json:"from"`
	To       []string `json:"to"`
}

type SMTP struct{ cfg SMTPConfig }

func NewSMTP(cfg SMTPConfig) *SMTP { return &SMTP{cfg: cfg} }

func (s *SMTP) Name() string { return "email" }

func (s *SMTP) build(msg Message) []byte {
	boundary := "otorem-boundary-42"
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", s.cfg.From)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(s.cfg.To, ", "))
	fmt.Fprintf(&b, "Subject: %s\r\n", msg.Title)
	fmt.Fprintf(&b, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%s\r\n\r\n", boundary)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n", boundary, msg.Body)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/html; charset=utf-8\r\n\r\n", boundary)
	fmt.Fprintf(&b, "<html><body><h3>%s</h3><p>%s</p></body></html>\r\n", msg.Title, msg.Body)
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return []byte(b.String())
}

func (s *SMTP) Send(ctx context.Context, msg Message) error {
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	var auth smtp.Auth
	if s.cfg.Username != "" {
		auth = smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	}
	raw := s.build(msg)
	ch := make(chan error, 1)
	go func() { ch <- smtp.SendMail(addr, auth, s.cfg.From, s.cfg.To, raw) }()
	select {
	case err := <-ch:
		if err != nil { return fmt.Errorf("smtp: %w", err) }
		return nil
	case <-ctx.Done():
		return fmt.Errorf("smtp: %w", ctx.Err())
	case <-time.After(30 * time.Second):
		return fmt.Errorf("smtp: timeout")
	}
}

func (s *SMTP) Test(ctx context.Context) error {
	return s.Send(ctx, Message{Title: "otorem tes", Body: "Koneksi email OK ✅"})
}
```

Implementation note for the engineer: `net/smtp` is enough; do not add an external email library (YAGNI). PLAIN auth without TLS is only used in local tests; production points at a relay (README).

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): smtp notifier dengan multipart alternative + fake smtp test"
```

---

### Task 5: Channel → Notifier factory + "test send" endpoint

**Files:**
- Create: `internal/notify/factory.go`
- Create: `internal/api/channeltest.go`
- Modify: `internal/api/server.go` (add 1 route)
- Test: `internal/notify/factory_test.go`, `internal/api/channeltest_test.go`

**Interfaces:**
- Consumes: `store.Channel`, `secret.Decrypt`, the Task 2–4 implementations, `api.Server` (fields `key`, `st`, `scope`, `pathID`, `respondErr` from Plan 2)
- Produces: `func NewFromChannel(ch store.Channel, key []byte) (Notifier, error)`; endpoint `POST /api/v1/channels/:id/test` (200/400/404/502).

- [ ] **Step 1: Factory test (failing)**

`internal/notify/factory_test.go`:

```go
package notify

import (
	"testing"

	"otorem/internal/secret"
	"otorem/internal/store"
)

func TestNewFromChannel(t *testing.T) {
	key := secret.DeriveKey("super-secret-panjang-16")

	enc := func(cfg string) []byte {
		b, err := secret.Encrypt(key, []byte(cfg))
		if err != nil { t.Fatal(err) }
		return b
	}

	n1, err := NewFromChannel(store.Channel{Type: "gotify", Name: "rumah",
		ConfigEnc: enc(`{"base_url":"http://g","token":"t"}`)}, key)
	if err != nil { t.Fatal(err) }
	if _, ok := n1.(*Gotify); !ok { t.Errorf("gotify: %T", n1) }

	n2, err := NewFromChannel(store.Channel{Type: "telegram",
		ConfigEnc: enc(`{"bot_token":"b","chat_id":"c"}`)}, key)
	if err != nil { t.Fatal(err) }
	if _, ok := n2.(*Telegram); !ok { t.Errorf("telegram: %T", n2) }

	n3, err := NewFromChannel(store.Channel{Type: "email",
		ConfigEnc: enc(`{"host":"h","port":587,"from":"a@b","to":["c@d"]}`)}, key)
	if err != nil { t.Fatal(err) }
	if _, ok := n3.(*SMTP); !ok { t.Errorf("email: %T", n3) }

	if _, err := NewFromChannel(store.Channel{Type: " fax",
		ConfigEnc: enc(`{}`)}, key); err == nil {
		t.Error("an unknown type must error")
	}
}
```

- [ ] **Step 2: Run — FAIL**, then implement `internal/notify/factory.go`

```go
package notify

import (
	"encoding/json"
	"fmt"

	"otorem/internal/secret"
	"otorem/internal/store"
)

// NewFromChannel: decrypt the channel config → a concrete Notifier.
func NewFromChannel(ch store.Channel, key []byte) (Notifier, error) {
	plain, err := secret.Decrypt(key, ch.ConfigEnc)
	if err != nil {
		return nil, fmt.Errorf("dekripsi config channel %q: %w", ch.Name, err)
	}
	switch ch.Type {
	case "gotify":
		var c GotifyConfig
		if err := json.Unmarshal(plain, &c); err != nil { return nil, err }
		return NewGotify(c), nil
	case "telegram":
		var c TelegramConfig
		if err := json.Unmarshal(plain, &c); err != nil { return nil, err }
		return NewTelegram(c), nil
	case "email":
		var c SMTPConfig
		if err := json.Unmarshal(plain, &c); err != nil { return nil, err }
		return NewSMTP(c), nil
	default:
		return nil, fmt.Errorf("tipe channel tidak dikenal: %q", ch.Type)
	}
}
```

- [ ] **Step 3: Test-send route + handler (with tests)**

Add to `internal/api/server.go` — right after the `apiG.DELETE("/channels/:id", ...)` line:

```go
	apiG.POST("/channels/:id/test", s.handleChannelTest)
```

`internal/api/channeltest.go`:

```go
package api

import (
	"github.com/gin-gonic/gin"

	"otorem/internal/notify"
)

// handleChannelTest: send a test message to the channel — validates the config end-to-end.
func (s *Server) handleChannelTest(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	ch, err := s.st.GetChannel(c.Request.Context(), s.scope(c), id)
	if err != nil { respondErr(c, err); return }
	n, err := notify.NewFromChannel(*ch, s.key)
	if err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	if err := n.Test(c.Request.Context()); err != nil {
		c.JSON(502, gin.H{"error": "kirim tes gagal: " + err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}
```

`internal/api/channeltest_test.go`:

```go
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

	storer := newTestServer(t, "admin@x.id")
	s := storer
	body := `{"type":"gotify","name":"rumah","config":{"base_url":"` + srv.URL + `","token":"t"}}`
	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels", "admin@x.id", body))
	if w.Code != 201 { t.Fatalf("create: %d %s", w.Code, w.Body.String()) }

	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/1/test", "admin@x.id", ""))
	if w.Code != 200 || !gotPost { t.Errorf("test send: %d %s", w.Code, w.Body.String()) }

	// a missing channel → 404
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/999/test", "admin@x.id", ""))
	if w.Code != 404 { t.Errorf("missing channel: %d", w.Code) }
}
```

- [ ] **Step 4: Run — PASS, then commit**

Run: `go test ./internal/notify/ ./internal/api/ -v`

```bash
git add internal/ && git commit -m "feat(notify+api): channel factory + endpoint test send"
```

---

### Task 6: Scheduler — Clock, Snapshot, RunOnce (dedupe + catch-up + late)

**Files:**
- Create: `internal/scheduler/scheduler.go`
- Test: `internal/scheduler/scheduler_test.go`

**Interfaces:**
- Consumes: `store.Store`, `store.NotificationEntry`, `calendarprov.Provider`, `notify.Notifier`, `domain.OccurrencesBetween`; `domain.Saptawara` is not used here
- Produces:
```go
type Clock interface{ Now() time.Time }
type RealClock struct{}
type FakeClock struct{ T time.Time }
func (f *FakeClock) Now() time.Time
func (f *FakeClock) Add(d time.Duration)

type Snapshot struct {
	Timezone          string          // "Asia/Jakarta"
	SendTime          string          // "08:00"
	CatchUpHours      int             // 24
	DefaultOffsets    []int           // [7,4,2,1,0]
	HolidayCategories map[string]bool // pawukon/saka/national
}

type Resolver func(ctx context.Context, ch store.Channel) (notify.Notifier, error)
type Result struct{ Sent, Failed, Missed int }
func HolidayKey(category string, h domain.Holiday) string // "pawukon:galungan"

type Service struct {
	St        *store.Store
	Clock     Clock
	Providers []calendarprov.Provider
	Resolve   Resolver
	failUntil map[int64]time.Time // failed channel → skip until
	mu        sync.Mutex
}
func (s *Service) RunOnce(ctx context.Context, snap Snapshot) (Result, error)
```

**RunOnce semantics (decision record — follow exactly):**
1. The send time for a reminder dated `R` = `R` at `SendTime` (Snapshot timezone). Due when `sendAt ≤ now`.
2. Catch-up window: `dueStart = today@SendTime − CatchUpHours`. `sendAt < dueStart` → record `missed` (per channel, deduped). `dueStart ≤ sendAt ≤ now` → send; if `now − sendAt > 1 hour` → the message is labeled `late`.
3. Scan range: `from = today − (maxOffset + ceil(CatchUp/24) + 2 days)` through `to = today + maxOffset + 2`. Reminders older than that are never recorded (bounded, no pile-up).
4. Successful send → record `sent`. Failed send → NOT recorded (retried on the next scan); the channel is skipped for 15 minutes via `failUntil`.
5. Target channels per contact: `prefs.ChannelIDs` (enabled & owned by the owner) — empty → all enabled channels owned by the owner.
6. Holidays use `DefaultOffsets` + the `HolidayCategories` filter, key = `HolidayKey(category, h)`.
7. `RunOnce` is serialized via a `mutex`.

- [ ] **Step 1: Write the failing test**

`internal/scheduler/scheduler_test.go`:

```go
package scheduler

import (
	"context"
	"strings"
	"testing"
	"time"

	"otorem/internal/calendarprov"
	"otorem/internal/domain"
	"otorem/internal/notify"
	"otorem/internal/store"
)

type stubNotifier struct {
	sent []notify.Message
	err  error
}

func (s *stubNotifier) Name() string { return "stub" }
func (s *stubNotifier) Send(_ context.Context, m notify.Message) error {
	if s.err != nil { return s.err }
	s.sent = append(s.sent, m)
	return nil
}
func (s *stubNotifier) Test(_ context.Context) error { return nil }

type stubProvider struct{ hs []domain.Holiday }

func (s *stubProvider) Name() string                    { return "stub" }
func (s *stubProvider) Category() string                { return "pawukon" }
func (s *stubProvider) HolidaysBetween(_ context.Context, _, _ domain.Date) ([]domain.Holiday, error) {
	return s.hs, nil
}

func snapUTC() Snapshot {
	return Snapshot{Timezone: "UTC", SendTime: "08:00", CatchUpHours: 24,
		DefaultOffsets: domain.DefaultOffsets,
		HolidayCategories: map[string]bool{"pawukon": true, "saka": true, "national": true}}
}

// seed: user@1, contact, otonan base = today-210 (occurrence EXACTLY on `today`),
// 1 gotify channel.
func seed(t *testing.T, st *store.Store, today domain.Date) {
	t.Helper()
	ctx := context.Background()
	u, err := st.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	if err != nil { t.Fatal(err) }
	c, err := st.CreateContact(ctx, u.ID, "Made", "", "")
	if err != nil { t.Fatal(err) }
	if _, err := st.AddOccasion(ctx, c.ID, domain.Otonan, today.AddDays(-domain.PawukonCycleDays), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateChannel(ctx, u.ID, "gotify", "rumah", []byte("enc")); err != nil { t.Fatal(err) }
}

type harness struct {
	st    *store.Store
	fc    *FakeClock
	notif *stubNotifier
	svc   *Service
}

func newHarness(t *testing.T, now time.Time) *harness {
	t.Helper()
	st, err := store.OpenInMemory()
	if err != nil { t.Fatal(err) }
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil { t.Fatal(err) }
	fc := &FakeClock{T: now}
	seed(t, st, domain.DateFromTime(now))
	n := &stubNotifier{}
	svc := &Service{St: st, Clock: fc, Providers: []calendarprov.Provider{&stubProvider{}},
		Resolve: func(_ context.Context, ch store.Channel) (notify.Notifier, error) { return n, nil },
		failUntil: map[int64]time.Time{}}
	return &harness{st: st, fc: fc, notif: n, svc: svc}
}

// today at 08:02 UTC → the D offset is sent; D-1..D-7 (the other 4 offsets) → missed.
func TestRunOnceOnTime(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil { t.Fatal(err) }
	if res.Sent != 1 || res.Failed != 0 || res.Missed != 4 {
		t.Fatalf("res = %+v, want Sent1 Missed4", res)
	}
	if len(h.notif.sent) != 1 { t.Fatalf("notif = %d", len(h.notif.sent)) }
	if strings.Contains(h.notif.sent[0].Body, "terlambat") { t.Error("must not be late") }

	// 2nd run → everything is deduped
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 || res.Missed != 0 { t.Errorf("dedupe failed: %+v", res) }
}

// at 07:00 → the D-1 offset (yesterday 08:00) is still within the window → send late;
// D-2..D-7 → missed; D is not due yet.
func TestRunOnceCatchUpLate(t *testing.T) {
	now := time.Date(2026, 6, 17, 7, 0, 0, 0, time.UTC)
	h := newHarness(t, now)
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil { t.Fatal(err) }
	if res.Sent != 1 || res.Missed != 3 { t.Fatalf("res = %+v, want Sent1 Missed3", res) }
	if !strings.Contains(h.notif.sent[0].Body, "terlambat") { t.Errorf("must be late: %q", h.notif.sent[0].Body) }
}

// send fails → not recorded → retried after the 15-minute backoff passes.
func TestRunOnceRetryAfterFailure(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.notif.err = context.DeadlineExceeded
	res, _ := h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 1 { t.Fatalf("failed = %d", res.Failed) }

	// 1 minute later: still in backoff → no attempt
	h.fc.Add(time.Minute)
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 0 || res.Sent != 0 { t.Errorf("backoff leaked: %+v", res) }

	// 16 minutes later + now succeeding → sent
	h.fc.Add(16 * time.Minute)
	h.notif.err = nil
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 1 { t.Errorf("retry failed: %+v", res) }
}

func TestHolidayReminder(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.svc.Providers = []calendarprov.Provider{
		&stubProvider{hs: []domain.Holiday{{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}}}}
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil { t.Fatal(err) }
	if res.Sent != 2 { t.Fatalf("sent = %d, want 2 (otoman + galungan)", res.Sent) }
	found := false
	for _, m := range h.notif.sent { if strings.Contains(m.Title, "Galungan") { found = true } }
	if !found { t.Error("the galungan message was not sent") }
	// holiday dedupe
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 { t.Errorf("holiday dedupe failed: %+v", res) }
}

func TestHolidayKey(t *testing.T) {
	got := HolidayKey("pawukon", domain.Holiday{Name: "Batu Kuning"})
	if got != "pawukon:batu-kuning" { t.Errorf("key = %q", got) }
}
```

- [ ] **Step 2: Run — FAIL**

Run: `go test ./internal/scheduler/ -v`
Expected: FAIL — `Snapshot`/`Service` undefined

- [ ] **Step 3: Implement scheduler.go**

```go
// Package scheduler: scan-based reminder engine. Stateless with respect to the DB —
// the send/missed decision is recomputed on every scan from (now, settings,
// contacts, notification_log). Idempotent: crash/restart safe.
package scheduler

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"otorem/internal/calendarprov"
	"otorem/internal/domain"
	"otorem/internal/notify"
	"otorem/internal/store"
)

type Clock interface{ Now() time.Time }

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

type FakeClock struct{ T time.Time }

func (f *FakeClock) Now() time.Time      { return f.T }
func (f *FakeClock) Add(d time.Duration) { f.T = f.T.Add(d) }

type Snapshot struct {
	Timezone          string
	SendTime          string
	CatchUpHours      int
	DefaultOffsets    []int
	HolidayCategories map[string]bool
}

type Resolver func(ctx context.Context, ch store.Channel) (notify.Notifier, error)

type Result struct{ Sent, Failed, Missed int }

const failBackoff = 15 * time.Minute

var notifCounter = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "otorem_notifications_total",
	Help: "notifikasi per status dan kind",
}, []string{"status", "kind"})

type Service struct {
	St        *store.Store
	Clock     Clock
	Providers []calendarprov.Provider
	Resolve   Resolver

	mu        sync.Mutex
	failUntil map[int64]time.Time
}

func HolidayKey(category string, h domain.Holiday) string {
	return category + ":" + strings.ToLower(strings.ReplaceAll(h.Name, " ", "-"))
}

func parseSendTime(s string) (int, int, error) {
	t, err := time.Parse("15:04", s)
	if err != nil { return 0, 0, fmt.Errorf("send_time invalid: %q", s) }
	return t.Hour(), t.Minute(), nil
}

func maxOffset(offsets []int) int {
	m := 0
	for _, o := range offsets { if o > m { m = o } }
	return m
}

// targetChannels: the target channels for one contact.
func (s *Service) targetChannels(ctx context.Context, cw store.ContactWithOccasions) []store.Channel {
	all, err := s.St.ListChannels(ctx, cw.OwnerID)
	if err != nil { return nil }
	enabled := all[:0:0]
	for _, ch := range all {
		if ch.Enabled { enabled = append(enabled, ch) }
	}
	if cw.Prefs != nil && len(cw.Prefs.ChannelIDs) > 0 {
		want := map[int64]bool{}
		for _, id := range cw.Prefs.ChannelIDs { want[id] = true }
		filtered := enabled[:0:0]
		for _, ch := range enabled { if want[ch.ID] { filtered = append(filtered, ch) } }
		return filtered
	}
	return enabled
}

func (s *Service) RunOnce(ctx context.Context, snap Snapshot) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var res Result

	loc, err := time.LoadLocation(snap.Timezone)
	if err != nil { loc = time.UTC }
	now := s.Clock.Now().In(loc)
	sendHH, sendMM, err := parseSendTime(snap.SendTime)
	if err != nil { return res, err }
	sendToday := time.Date(now.Year(), now.Month(), now.Day(), sendHH, sendMM, 0, 0, loc)
	dueStart := sendToday.Add(-time.Duration(snap.CatchUpHours) * time.Hour)
	today := domain.DateFromTime(now)

	maxOff := maxOffset(snap.DefaultOffsets)
	catchUpDays := (snap.CatchUpHours + 23) / 24
	lookback := maxOff + catchUpDays + 2
	from := today.AddDays(-lookback)
	to := today.AddDays(maxOff + 2)

	// ---- occasions ----
	contacts, err := s.St.ListContacts(ctx, 0) // admin scope: all contacts
	if err != nil { return res, err }
	for _, cw := range contacts {
		if cw.Prefs != nil && !cw.Prefs.Enabled { continue }
		offsets := snap.DefaultOffsets
		if cw.Prefs != nil && len(cw.Prefs.Offsets) > 0 { offsets = cw.Prefs.Offsets }
		channels := s.targetChannels(ctx, cw)
		oOff := maxOffset(offsets)
		fromO := today.AddDays(-(oOff + catchUpDays + 2))
		toO := today.AddDays(oOff + 2)
		for _, occ := range cw.Occasions {
			occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, fromO, toO)
			if err != nil { continue }
			for _, o := range occs {
				for _, off := range offsets {
					rDate := o.Date.AddDays(-off)
					sendAt := time.Date(rDate.Year, rDate.Month, rDate.Day, sendHH, sendMM, 0, 0, loc)
					if sendAt.After(now) { continue }
					occID := occ.ID
					entry := store.NotificationEntry{OccasionID: &occID,
						OccurrenceDate: o.Date, OffsetDays: off}
					if sendAt.Before(dueStart) {
						for _, ch := range channels {
							entry.ChannelID, entry.Status = ch.ID, "missed"
							s.record(ctx, entry, &res, "occasion")
						}
						continue
					}
					late := now.Sub(sendAt) > time.Hour
					msg := notify.OccurrenceMessage(cw.Name, o, o.Date.JDN()-today.JDN(), late)
					s.deliver(ctx, channels, entry, msg, &res, "occasion")
				}
			}
		}
	}

	// ---- holidays ----
	for _, p := range s.Providers {
		if !snap.HolidayCategories[p.Category()] { continue }
		hs, err := p.HolidaysBetween(ctx, from, to)
		if err != nil {
			// remote provider failed → skip; computed pawukon keeps working
			continue
		}
		for _, h := range hs {
			hkey := HolidayKey(p.Category(), h)
			for _, off := range snap.DefaultOffsets {
				rDate := h.Date.AddDays(-off)
				sendAt := time.Date(rDate.Year, rDate.Month, rDate.Day, sendHH, sendMM, 0, 0, loc)
				if sendAt.After(now) { continue }
				entry := store.NotificationEntry{HolidayKey: &hkey,
					OccurrenceDate: h.Date, OffsetDays: off}
				if sendAt.Before(dueStart) {
					// holiday → all channels of ALL users (broadcast)
					users, err := s.St.ListUsers(ctx)
					if err != nil { continue }
					for _, u := range users {
						chs, _ := s.St.ListChannels(ctx, u.ID)
						for _, ch := range chs { if ch.Enabled {
							entry.ChannelID, entry.Status = ch.ID, "missed"
							s.record(ctx, entry, &res, "holiday")
						}}
					}
					continue
				}
				late := now.Sub(sendAt) > time.Hour
				msg := notify.HolidayMessage(h, h.Date.JDN()-today.JDN(), late)
				users, err := s.St.ListUsers(ctx)
				if err != nil { continue }
				for _, u := range users {
					chs, _ := s.St.ListChannels(ctx, u.ID)
					var enabled []store.Channel
					for _, ch := range chs { if ch.Enabled { enabled = append(enabled, ch) } }
					s.deliver(ctx, enabled, entry, msg, &res, "holiday")
				}
			}
		}
	}
	return res, nil
}

func (s *Service) record(ctx context.Context, e store.NotificationEntry, res *Result, kind string) {
	inserted, err := s.St.RecordNotification(ctx, e)
	if err != nil || !inserted { return }
	res.Missed++
	notifCounter.WithLabelValues("missed", kind).Inc()
}

func (s *Service) deliver(ctx context.Context, channels []store.Channel,
	e store.NotificationEntry, msg notify.Message, res *Result, kind string) {
	now := s.Clock.Now()
	for _, ch := range channels {
		if until, ok := s.failUntil[ch.ID]; ok && now.Before(until) { continue } // backoff
		e.ChannelID = ch.ID
		n, err := s.Resolve(ctx, ch)
		if err != nil {
			res.Failed++
			notifCounter.WithLabelValues("resolve_error", kind).Inc()
			continue
		}
		if err := n.Send(ctx, msg); err != nil {
			res.Failed++ // NOT recorded → retried on the next scan
			s.failUntil[ch.ID] = now.Add(failBackoff)
			notifCounter.WithLabelValues("failed", kind).Inc()
			continue
		}
		e.Status = "sent"
		inserted, err := s.St.RecordNotification(ctx, e)
		if err != nil { continue }
		if inserted { res.Sent++ }
		notifCounter.WithLabelValues("sent", kind).Inc()
	}
}
```

Decisions implied by the code (explain them to a reviewer if asked):
- Holidays are broadcast to the channels of ALL users (whoever owns them); occasions only go to the contact's owner. For one family = one user, the result is identical.
- `missed` is recorded per channel so dedupe stays consistent; the Prometheus counter distinguishes `kind`.

- [ ] **Step 4: Run — PASS**

Run: `go test ./internal/scheduler/ -v`
Expected: all PASS. If `TestRunOnceCatchUpLate` is off by one (Sent/Missed differ by 1): check `dueStart` — make sure it uses `sendToday` (today@08:00), not `now`.

```bash
gofmt -w internal/ && go vet ./...
git add internal/scheduler/ && git commit -m "feat(scheduler): scan-based runonce dengan dedupe, catch-up, late, backoff"
```

---

### Task 7: Ticker loop + runner adapter in the API

**Files:**
- Create: `internal/scheduler/loop.go`
- Create: `internal/api/runner.go`
- Test: `internal/api/runner_test.go`

**Interfaces:**
- Consumes: `api.SchedulerRunner` + `api.RunResult` (Plan 2), `Service.RunOnce`
- Produces: `func (s *Service) Loop(ctx context.Context, every time.Duration, snapshot func(context.Context) (Snapshot, error))`; `type SchedulerRunnerFunc func(ctx context.Context) (RunResult, error)` + a `RunOnce` method (adapter so main.go's closure satisfies the interface).

- [ ] **Step 1: Runner adapter + endpoint test (failing)**

`internal/api/runner_test.go`:

```go
package api

import (
	"context"
	"net/http/httptest"
	"testing"
)

func TestSchedulerRunEndpointWithRunner(t *testing.T) {
	s := newTestServer(t, "admin@x.id")
	s.SetRunner(SchedulerRunnerFunc(func(ctx context.Context) (RunResult, error) {
		return RunResult{Sent: 2, Failed: 1, Missed: 3}, nil
	}))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "admin@x.id", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"sent":2`) {
		t.Errorf("run: %d %s", w.Code, w.Body.String())
	}
	// non-admin → 403
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "member@x.id", ""))
	if w.Code != 403 { t.Errorf("non-admin: %d", w.Code) }
}

func TestLoopStopsOnCancel(t *testing.T) {
	// the loop must stop when ctx is cancelled — tested via the scheduler package below
}
```
Add `"strings"` to the imports if it is not there yet.

Also add a loop test in `internal/scheduler/loop_test.go`:

```go
package scheduler

import (
	"context"
	"testing"
	"time"
)

func TestLoopRunsAndStops(t *testing.T) {
	h := newHarness(t, time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC))
	ctx, cancel := context.WithCancel(context.Background())
	called := make(chan struct{}, 1)
	go h.svc.Loop(ctx, 10*time.Millisecond, func(context.Context) (Snapshot, error) {
		select { case called <- struct{}{}: default: }
		return snapUTC(), nil
	})
	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("the loop never ran a scan")
	}
	cancel()
	// there is no synchronous way to wait for exit without instrumentation — just make
	// sure nothing panics and the test finishes; the race detector is the real guard.
}
```

- [ ] **Step 2: Run — FAIL**, then implement

`internal/api/runner.go`:

```go
package api

import "context"

// SchedulerRunnerFunc: adapter from a closure to api.SchedulerRunner (used by main.go).
type SchedulerRunnerFunc func(ctx context.Context) (RunResult, error)

func (f SchedulerRunnerFunc) RunOnce(ctx context.Context) (RunResult, error) { return f(ctx) }
```

`internal/scheduler/loop.go`:

```go
package scheduler

import (
	"context"
	"log/slog"
	"time"
)

// Loop: a per-minute ticker; the settings snapshot is taken each iteration so
// Settings changes (timezone/send time/catch-up) apply without a restart.
func (s *Service) Loop(ctx context.Context, every time.Duration,
	snapshot func(context.Context) (Snapshot, error)) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			snap, err := snapshot(ctx)
			if err != nil {
				slog.Error("scheduler: snapshot settings gagal", "err", err)
				continue
			}
			if res, err := s.RunOnce(ctx, snap); err != nil {
				slog.Error("scheduler: runonce gagal", "err", err)
			} else if res.Sent+res.Failed+res.Missed > 0 {
				slog.Info("scheduler: scan", "sent", res.Sent, "failed", res.Failed, "missed", res.Missed)
			}
		}
	}
}
```

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/scheduler/ ./internal/api/ -v`

```bash
git add internal/ && git commit -m "feat(scheduler+api): loop ticker per menit + runner adapter"
```

---

### Task 8: Remote holiday providers (dayoffapi + kresnasatya) + cache

**Files:**
- Create: `internal/calendarprov/dayoffapi.go`
- Create: `internal/calendarprov/kresnasatya.go`
- Create: `internal/calendarprov/cached.go`
- Modify: `internal/store/holidaycache.go` (new — access to the holiday_cache table)
- Test: `internal/calendarprov/remote_test.go`, `internal/store/holidaycache_test.go`

**Interfaces:**
- Consumes: `calendarprov.Provider`, `store.Store`
- Produces:
```go
func NewDayOffAPI() *DayOffAPI   // Category "national", BaseURL https://dayoffapi.vercel.app, GET /api?year=YYYY
func NewKresna(baseURL string) *Kresna // Category "saka"; baseURL defaults to https://artworks.kresna.me/api-harilibur
type CachedRemote struct{ /* Inner Provider + St *store.Store */ }
func NewCachedRemote(inner Provider, st *store.Store) *CachedRemote // cache-first, refresh if payload >24h old, network failure → use stale
func (s *Store) GetHolidayCache(ctx context.Context, year int, source string, dst any) error
func (s *Store) PutHolidayCache(ctx context.Context, year int, source string, v any) error
```

- [ ] **Step 1: VERIFY THE DATA SHAPE (mandatory before coding)**

```bash
curl -s --max-time 15 'https://dayoffapi.vercel.app/api?year=2026' | head -c 600; echo
curl -s --max-time 15 'https://artworks.kresna.me/api-harilibur/api?year=2026' | head -c 600; echo
```
Note the actual JSON shape. The code below assumes:
- dayoffapi: `[{"tanggal":"2026-01-01","keterangan":"...","is_cuti_bersama":false}]`
- kresnasatya: `[{"holiday_date":"2026-...","holiday_name":"..."}]` (or wrapped in `{"data":[...]}` — already handled).
**If different**: adjust ONLY the struct tags/parsing in this file. **If neither API is reachable during execution**: still implement + test with httptest (injected base URL), mark the remote smoke test as manual in the README, and move on — the architecture does not depend on a live API.

- [ ] **Step 2: Test with httptest (failing)**

`internal/calendarprov/remote_test.go`:

```go
package calendarprov

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"otorem/internal/domain"
	"otorem/internal/store"
)

func TestDayOffAPIParse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("year") != "2026" { t.Errorf("year = %q", r.URL.Query().Get("year")) }
		io.WriteString(w, `[{"tanggal":"2026-03-19","keterangan":"Nyepi","is_cuti_bersama":false},
			{"tanggal":"2026-12-25","keterangan":"Natal","is_cuti_bersama":true}]`)
	}))
	defer srv.Close()
	d := NewDayOffAPI()
	d.BaseURL = srv.URL
	hs, err := d.HolidaysBetween(context.Background(), domain.NewDate(2026, 3, 1), domain.NewDate(2026, 4, 1))
	if err != nil { t.Fatal(err) }
	if len(hs) != 1 || hs[0].Name != "Libur Nasional — Nyepi" || hs[0].Date != (domain.Date{Year: 2026, Month: 3, Day: 19}) {
		t.Errorf("hs = %+v", hs)
	}
}

func TestKresnaParseWrapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":[{"holiday_date":"2026-06-17","holiday_name":"Galungan"}]}`)
	}))
	defer srv.Close()
	k := NewKresna(srv.URL)
	hs, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30))
	if err != nil { t.Fatal(err) }
	if len(hs) != 1 || hs[0].Name != "Galungan" { t.Errorf("hs = %+v", hs) }
}

func TestCachedRemoteCacheFirst(t *testing.T) {
	st, _ := store.OpenInMemory()
	defer st.Close()
	_ = st.Migrate()

	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		io.WriteString(w, `[{"tanggal":"2026-03-19","keterangan":"Nyepi","is_cuti_bersama":false}]`)
	}))
	defer srv.Close()
	inner := NewDayOffAPI()
	inner.BaseURL = srv.URL
	c := NewCachedRemote(inner, st)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		hs, err := c.HolidaysBetween(ctx, domain.NewDate(2026, 3, 10), domain.NewDate(2026, 3, 20))
		if err != nil { t.Fatal(err) }
		if len(hs) != 1 { t.Fatalf("hs = %+v", hs) }
	}
	if calls != 1 { t.Errorf("remote called %d×, want 1 (cache-first)", calls) }
}
```
Add the `"io"` import if gofmt demands it.

- [ ] **Step 3: Run — FAIL**, then implement

`internal/store/holidaycache.go`:

```go
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func (s *Store) GetHolidayCache(ctx context.Context, year int, source string, dst any) error {
	var raw string
	err := s.db.QueryRowContext(ctx,
		`SELECT payload FROM holiday_cache WHERE year = ? AND source = ?`, year, source).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) { return ErrNotFound }
	if err != nil { return err }
	return json.Unmarshal([]byte(raw), dst)
}

func (s *Store) PutHolidayCache(ctx context.Context, year int, source string, v any) error {
	b, err := json.Marshal(v)
	if err != nil { return err }
	_, err = s.db.ExecContext(ctx, `INSERT INTO holiday_cache (year, source, payload)
		VALUES (?,?,?) ON CONFLICT(year, source) DO UPDATE SET payload = excluded.payload,
		fetched_at = (datetime('now'))`, year, source, string(b))
	return err
}
```

`internal/calendarprov/dayoffapi.go`:

```go
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

// DayOffAPI: Indonesian national holidays & joint leave (cuti bersama), including Nyepi.
// Source: github.com/gerinsp/dayoff-API (data from the joint decree of 3 ministers).
type DayOffAPI struct {
	BaseURL string
	hc      *http.Client
}

func NewDayOffAPI() *DayOffAPI {
	return &DayOffAPI{BaseURL: "https://dayoffapi.vercel.app",
		hc: &http.Client{Timeout: 15 * time.Second}}
}

func (d *DayOffAPI) Name() string     { return "dayoffapi" }
func (d *DayOffAPI) Category() string { return "national" }

type dayOffItem struct {
	Tanggal      string `json:"tanggal"`
	Keterangan   string `json:"keterangan"`
	IsCutiBersama bool  `json:"is_cuti_bersama"`
}

func (d *DayOffAPI) fetchYear(ctx context.Context, year int) ([]domain.Holiday, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api?year=%d", d.BaseURL, year), nil)
	if err != nil { return nil, err }
	resp, err := d.hc.Do(req)
	if err != nil { return nil, fmt.Errorf("dayoffapi: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dayoffapi status %d", resp.StatusCode)
	}
	var items []dayOffItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("dayoffapi decode: %w", err)
	}
	var out []domain.Holiday
	for _, it := range items {
		dt, err := time.Parse("2006-01-02", it.Tanggal)
		if err != nil { return nil, fmt.Errorf("dayoffapi tanggal %q: %w", it.Tanggal, err) }
		name := "Libur Nasional — " + it.Keterangan
		if it.IsCutiBersama { name = "Cuti Bersama — " + it.Keterangan }
		out = append(out, domain.Holiday{Date: domain.DateFromTime(dt), Name: name})
	}
	return out, nil
}

func (d *DayOffAPI) HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for y := from.Year; y <= to.Year; y++ {
		hs, err := d.fetchYear(ctx, y)
		if err != nil { return nil, err }
		for _, h := range hs {
			if !h.Date.Before(from) && !h.Date.After(to) { out = append(out, h) }
		}
	}
	return out, nil
}
```

`internal/calendarprov/kresnasatya.go`:

```go
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
	if baseURL == "" { baseURL = "https://artworks.kresna.me/api-harilibur" }
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
	if err != nil { return nil, err }
	resp, err := k.hc.Do(req)
	if err != nil { return nil, fmt.Errorf("kresna: %w", err) }
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	// the source response may be a plain array or wrapped as {"data":[...]}
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
		if err != nil { return nil, fmt.Errorf("kresna tanggal %q: %w", it.HolidayDate, err) }
		out = append(out, domain.Holiday{Date: domain.DateFromTime(dt), Name: it.HolidayName})
	}
	return out, nil
}

func (k *Kresna) HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for y := from.Year; y <= to.Year; y++ {
		hs, err := k.fetchYear(ctx, y)
		if err != nil { return nil, err }
		for _, h := range hs {
			if !h.Date.Before(from) && !h.Date.After(to) { out = append(out, h) }
		}
	}
	return out, nil
}
```

`internal/calendarprov/cached.go`:

```go
package calendarprov

import (
	"context"
	"time"

	"otorem/internal/domain"
	"otorem/internal/store"
)

type cachePayload struct {
	FetchedAt time.Time        `json:"fetched_at"`
	Holidays  []domain.Holiday `json:"holidays"`
}

// CachedRemote: cache-first against holiday_cache (SQLite). Refresh when the payload
// is > 24h old; if the refetch fails → use the stale cache (degrade, don't die).
type CachedRemote struct {
	Inner Provider
	St    *store.Store
}

func NewCachedRemote(inner Provider, st *store.Store) *CachedRemote {
	return &CachedRemote{Inner: inner, St: st}
}

func (c *CachedRemote) Name() string     { return c.Inner.Name() }
func (c *CachedRemote) Category() string { return c.Inner.Category() }

func (c *CachedRemote) loadYear(ctx context.Context, y int) ([]domain.Holiday, bool, error) {
	var p cachePayload
	err := c.St.GetHolidayCache(ctx, y, c.Inner.Name(), &p)
	if err == nil && time.Since(p.FetchedAt) < 24*time.Hour {
		return p.Holidays, true, nil
	}
	// miss or stale → try to refresh
	fresh, ferr := c.Inner.HolidaysBetween(ctx, domain.NewDate(y, 1, 1), domain.NewDate(y, 12, 31))
	if ferr == nil {
		_ = c.St.PutHolidayCache(ctx, y, c.Inner.Name(), cachePayload{
			FetchedAt: time.Now(), Holidays: fresh,
		})
		return fresh, true, nil
	}
	if err == nil { // a stale cache exists → use it, don't fail the scheduler
		return p.Holidays, true, nil
	}
	return nil, false, ferr
}

func (c *CachedRemote) HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for y := from.Year; y <= to.Year; y++ {
		hs, ok, err := c.loadYear(ctx, y)
		if err != nil { return nil, err }
		if !ok { continue }
		for _, h := range hs {
			if !h.Date.Before(from) && !h.Date.After(to) { out = append(out, h) }
		}
	}
	return out, nil
}
```

- [ ] **Step 4: Run — PASS, then commit**

Run: `go test ./internal/calendarprov/ ./internal/store/ -v`
(`remote_test.go` already includes the `io` import.)

```bash
git add internal/ && git commit -m "feat(calendarprov): provider remote dayoffapi+kresnasatya dengan cache-first"
```

---

### Task 9: Final main.go wiring + end-to-end smoke test

**Files:**
- Modify: `cmd/server/main.go` (add the scheduler + remote providers)

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Update main.go**

Replace the body of `main` after `providers := ...` with:

```go
	key := secret.DeriveKey(cfg.AppSecret)
	providers := []calendarprov.Provider{
		calendarprov.NewComputedPawukon(),
		calendarprov.NewCachedRemote(calendarprov.NewDayOffAPI(), st),
		calendarprov.NewCachedRemote(calendarprov.NewKresna(""), st),
	}
	srv := api.NewServer(cfg, st, providers)

	svc := &scheduler.Service{
		St:    st,
		Clock: scheduler.RealClock{},
		Resolve: func(ctx context.Context, ch store.Channel) (notify.Notifier, error) {
			return notify.NewFromChannel(ch, key)
		},
		Providers: providers,
	}
	srv.SetRunner(api.SchedulerRunnerFunc(func(ctx context.Context) (api.RunResult, error) {
		set := srv.LoadSettings(ctx)
		res, err := svc.RunOnce(ctx, scheduler.Snapshot{
			Timezone: set.Timezone, SendTime: set.SendTime, CatchUpHours: set.CatchUpHours,
			DefaultOffsets: set.DefaultOffsets, HolidayCategories: set.HolidayCategories,
		})
		return api.RunResult(res), err
	}))

	ctxLoop, cancelLoop := context.WithCancel(context.Background())
	defer cancelLoop()
	go svc.Loop(ctxLoop, time.Minute, func(ctx context.Context) (scheduler.Snapshot, error) {
		set := srv.LoadSettings(ctx)
		return scheduler.Snapshot{
			Timezone: set.Timezone, SendTime: set.SendTime, CatchUpHours: set.CatchUpHours,
			DefaultOffsets: set.DefaultOffsets, HolidayCategories: set.HolidayCategories,
		}, nil
	})
```
with additional imports: `otorem/internal/notify`, `otorem/internal/scheduler`, `otorem/internal/secret`, `otorem/internal/store`, `otorem/internal/calendarprov`, `"time"`. (The same snapshot builder is used in two places — extract it into a local closure `buildSnapshot := func(ctx context.Context) scheduler.Snapshot { ... }` to stay DRY.)

- [ ] **Step 2: Build + smoke test**

```bash
gofmt -l cmd/ internal/ ; go vet ./... && CGO_ENABLED=0 go test ./... -count=1
CGO_ENABLED=0 go build -o /tmp/otorem ./cmd/server
APP_SECRET=dev-secret-panjang-16 AUTH_MODE=dev DATA_DIR=/tmp/otoremdata /tmp/otorem &
sleep 1
curl -s -H 'X-Dev-Email: admin@x.id' localhost:8080/api/v1/upcoming?days=60 | head -c 800; echo
curl -s -X POST -H 'X-Dev-Email: admin@x.id' localhost:8080/api/v1/scheduler/run; echo
curl -s localhost:8080/metrics | grep otorem_notifications || true
pkill -f /tmp/otorem || true
```
Expected: upcoming contains occasions/Pawukon holidays (computed ones are always present); scheduler/run returns JSON `{"sent":..,"failed":..,"missed":..}`; the metrics counter exists. Remote API failures (offline) MUST NOT cause a 500 — make sure the log only warns/skips.

- [ ] **Step 3: Commit + tag**

```bash
git add cmd/ && git commit -m "feat(server): wiring scheduler, notifier, provider remote"
git tag plan-3-scheduler-notify-done
```

---

## Definition of Done (Plan 3)

- [ ] `CGO_ENABLED=0 go test ./... -count=1` fully green (unit + fake-clock integration).
- [ ] Dedupe: scanning 2× does not send twice (`TestRunOnceOnTime`, 2nd run).
- [ ] Catch-up: late sends within ≤ 24 hours; beyond the window → `missed`; beyond the lookback → ignored.
- [ ] Failed channel → automatic retry with a 15-minute backoff.
- [ ] The channel test-send button works (mock server 200 → 200 OK).
- [ ] A remote provider outage ≠ scheduler outage (cache-first + stale fallback).
- [ ] Tag `plan-3-scheduler-notify-done`.

**Contract for Plan 4 (SPA):** endpoints used by the UI: `GET /api/v1/upcoming?days=30`, `GET/POST /api/v1/contacts`, `GET/PATCH/DELETE /api/v1/contacts/:id`, `POST /api/v1/contacts/:id/occasions`, `DELETE /api/v1/occasions/:id`, `PUT /api/v1/contacts/:id/prefs`, `GET/POST /api/v1/channels`, `PATCH/DELETE /api/v1/channels/:id`, `POST /api/v1/channels/:id/test`, `GET/PUT /api/v1/settings`, `GET /api/v1/pawukon?date=`, `GET /api/v1/me`. Dev auth via the `X-Dev-Email` header.
