# otorem Plan 3/4: Scheduler + Notifier + Holiday Provider Remote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mesin pengirim notifikasi yang andal: interface `Notifier` (Gotify/Telegram/SMTP) dengan retry & backoff, scheduler scan-based per menit dengan dedupe + catch-up window, dan provider hari raya remote (libur nasional + hari raya Bali) dengan cache lokal.

**Architecture:** `internal/notify` (interface + 3 implementasi + factory dari channel terenkripsi), `internal/scheduler` (Clock interface + Service scan-based stateless), penambahan kecil di `internal/api` (endpoint test channel + runner adapter), `internal/calendarprov` (2 provider remote + CachedRemote), dan wiring final di `cmd/server/main.go`.

**Tech Stack:** stdlib (`net/smtp`, `net/http`), `github.com/prometheus/client_golang` (sudah ada). Tidak ada dependency baru kecuali kebutuhan tak terduga.

## Global Constraints

- Semua tanggal/timezone dikonversi HANYA di scheduler via `Snapshot.Timezone`; domain tetap civil `Date`.
- **Dedupe**: sukses/missed dicatat ke `notification_log` (INSERT OR IGNORE). **Gagal TIDAK dicatat** → retry otomatis di scan berikutnya (maks 1×/menit) sampai sukses atau lewat window. Anti-spam: channel gagal di-skip 15 menit (in-memory `failUntil`).
- `RunOnce` dijaga `sync.Mutex` (aman terhadap trigger manual bersamaan dengan ticker).
- Scheduler TIDAK PERNAH panggil internet langsung — semua via `calendarprov.Provider`; provider remote gagal → cache/stale, scheduler tetap jalan.
- Pesan notifikasi Bahasa Indonesia; HTML di-escape sebelum dikirim ke Telegram.
- TDD: test dulu → merah → implement → hijau → commit.
- Kontrak dari Plan 2 (HARUS dipakai persis): `api.Server.SetRunner(api.SchedulerRunner)`, `api.RunResult{Sent,Failed,Missed int}`, `api.Server.LoadSettings(ctx) api.Settings`, `notify` belum ada, `store.RecordNotification`, `store.ListChannels(ctx, ownerID)`, `secret.DeriveKey`, `calendarprov.Provider{Name,Category,HolidaysBetween}`, `domain.OccurrencesBetween`, `domain.ReminderDates` tidak dipakai scheduler (offset dihitung langsung: `occDate.AddDays(-off)`).

---

### Task 1: notify core — Message, Notifier, template pesan

**Files:**
- Create: `internal/notify/notify.go`
- Create: `internal/notify/message.go`
- Test: `internal/notify/message_test.go`

**Interfaces:**
- Produces:
```go
type Message struct{ Title string; Body string; Priority int } // Priority 1..10 (ala Gotify)
type Notifier interface {
	Name() string
	Send(ctx context.Context, msg Message) error
	Test(ctx context.Context) error
}
func OccurrenceMessage(contactName string, occ domain.Occurrence, daysUntil int, late bool) Message
func HolidayMessage(h domain.Holiday, daysUntil int, late bool) Message
func TanggalIndo(d domain.Date) string // "Rabu, 17 Juni 2026"
```

- [ ] **Step 1: Tulis test yang gagal**

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
	if m.Priority != 8 { t.Errorf("hari ini harus prioritas 8, dapat %d", m.Priority) }
}

func TestLateSuffix(t *testing.T) {
	m := OccurrenceMessage("Budi", domain.Occurrence{Date: domain.NewDate(2026, 6, 17),
		Type: domain.Birthday, Number: 30}, 1, true)
	if !strings.Contains(m.Body, "terlambat") { t.Errorf("late flag tidak terlihat: %q", m.Body) }
}

func TestHolidayMessage(t *testing.T) {
	m := HolidayMessage(domain.Holiday{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}, 10, false)
	if !strings.Contains(m.Title, "Galungan") || !strings.Contains(m.Title, "10 hari lagi") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "Rabu, 17 Juni 2026") { t.Errorf("body = %q", m.Body) }
}
```

- [ ] **Step 2: Run — GAGAL**

Run: `go test ./internal/notify/ -v`
Expected: FAIL — `OccurrenceMessage undefined`

- [ ] **Step 3: Implementasi**

`internal/notify/notify.go`:

```go
// Package notify: pengiriman notifikasi ke Gotify, Telegram, dan Email.
// Interface Notifier diimplementasi 3 channel; factory dari channel DB ada
// di factory.go.
package notify

import "context"

type Message struct {
	Title    string
	Body     string
	Priority int // 1..10, ala Gotify; SMTP mengabaikan
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

// TanggalIndo: "Rabu, 17 Juni 2026" — nama hari memakai saptawara
// (Redite=Minggu, Soma=Senin, Anggara=Selasa, Buda=Rabu, dst).
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

- [ ] **Step 4: Run — PASS lalu commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): message/notifier contracts + template pesan indonesia"
```

---

### Task 2: Notifier Gotify

**Files:**
- Create: `internal/notify/gotify.go`
- Test: `internal/notify/gotify_test.go`

**Interfaces:**
- Consumes: `notify.Message`, `notify.Notifier`
- Produces: `type GotifyConfig struct{ BaseURL string `json:"base_url"`; Token string `json:"token"`; Priority int `json:"priority,omitempty"` }`; `func NewGotify(cfg GotifyConfig) *Gotify` (POST `{BaseURL}/message?token=...`, JSON `{title,message,priority}`, Priority default 5, timeout 10s, error jika status non-2xx).

- [ ] **Step 1: Test (gagal)**

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
		t.Errorf("err = %v, harus 401", err)
	}
}
```

- [ ] **Step 2: Run — GAGAL**, lalu implement `internal/notify/gotify.go`

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

- [ ] **Step 3: Run — PASS lalu commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): gotify notifier"
```

---

### Task 3: Notifier Telegram

**Files:**
- Create: `internal/notify/telegram.go`
- Test: `internal/notify/telegram_test.go`

**Interfaces:**
- Produces: `type TelegramConfig struct{ BotToken string `json:"bot_token"`; ChatID string `json:"chat_id"` }`; `func NewTelegram(cfg TelegramConfig) *Telegram` — POST `{base}/bot{token}/sendMessage` JSON `{chat_id, text, parse_mode:"HTML"}`; HTML-escape judul+isi; error jika `"ok":false`; field unexported `baseURL` (default `https://api.telegram.org`) untuk di-override test.

- [ ] **Step 1: Test (gagal)**

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
	if strings.Contains(gotBody, "<b>Halō</b>") { t.Errorf("HTML tidak di-escape: %q", gotBody) }
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
	// pastikan payload valid: parse kembali
	var m map[string]any
	_ = json.Unmarshal([]byte(`{"chat_id":"1","text":"x","parse_mode":"HTML"}`), &m)
	if m["parse_mode"] != "HTML" { t.Fatal("sanity json gagal") }
}
```

- [ ] **Step 2: Run — GAGAL**, lalu implement `internal/notify/telegram.go`

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

- [ ] **Step 3: Run — PASS lalu commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): telegram notifier dengan html escape"
```

---

### Task 4: Notifier Email (SMTP) + fake SMTP server test

**Files:**
- Create: `internal/notify/smtp.go`
- Test: `internal/notify/smtp_test.go` (berisi minimal fake SMTP server)

**Interfaces:**
- Produces: `type SMTPConfig struct{ Host string `json:"host"`; Port int `json:"port"`; Username, Password, From string `json:"..."`; To []string `json:"to"` }`; `func NewSMTP(cfg SMTPConfig) *SMTP` — `smtp.SendMail(host:port, PlainAuth, From, To, raw)` dengan pesan `multipart/alternative` (text + HTML), Subject = Title; Send menghormati ctx (goroutine + select).

- [ ] **Step 1: Test + fake SMTP server (gagal)**

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

// fakeSMTP: server SMTP minimal untuk test — cukup protokol dasar
// (220/250/354/221) dan menangkap isi DATA.
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
		To: []string{"budi@x.id"}}) // tanpa auth — fake menerima apa pun
	if err := s.Send(context.Background(), Message{Title: "🎂 ultah", Body: "isi pesan"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.data, "Subject: 🎂 ultah") { t.Errorf("subject: %q", f.data) }
	if !strings.Contains(f.data, "isi pesan") { t.Errorf("body text: %q", f.data) }
	if !strings.Contains(f.data, "multipart/alternative") { t.Errorf("harus multipart: %q", f.data) }
	if len(f.rcptTo) != 1 || !strings.Contains(f.rcptTo[0], "budi@x.id") { t.Errorf("rcpt: %v", f.rcptTo) }
}

func TestSMTPContextTimeout(t *testing.T) {
	// port yang pasti tidak melayang: koneksi akan gagal/timeout
	s := NewSMTP(SMTPConfig{Host: "127.0.0.1", Port: 1, From: "a@b.c", To: []string{"d@e.f"}})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.Send(ctx, Message{Title: "x"}); err == nil { t.Error("harus gagal") }
}
```

- [ ] **Step 2: Run — GAGAL**, lalu implement `internal/notify/smtp.go`

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

Catatan implementasi untuk engineer: `net/smtp` sudah cukup; jangan tambah library email eksternal (YAGNI). PLAIN auth tanpa TLS hanya dipakai di test lokal; produksi diarahkan ke relay (README).

- [ ] **Step 3: Run — PASS lalu commit**

Run: `go test ./internal/notify/ -v`

```bash
git add internal/notify/ && git commit -m "feat(notify): smtp notifier dengan multipart alternative + fake smtp test"
```

---

### Task 5: Factory channel → Notifier + endpoint "test send"

**Files:**
- Create: `internal/notify/factory.go`
- Create: `internal/api/channeltest.go`
- Modify: `internal/api/server.go` (tambah 1 route)
- Test: `internal/notify/factory_test.go`, `internal/api/channeltest_test.go`

**Interfaces:**
- Consumes: `store.Channel`, `secret.Decrypt`, implementasi Task 2–4, `api.Server` (field `key`, `st`, `scope`, `pathID`, `respondErr` dari Plan 2)
- Produces: `func NewFromChannel(ch store.Channel, key []byte) (Notifier, error)`; endpoint `POST /api/v1/channels/:id/test` (200/400/404/502).

- [ ] **Step 1: Test factory (gagal)**

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
		t.Error("tipe asing harus error")
	}
}
```

- [ ] **Step 2: Run — GAGAL**, lalu implement `internal/notify/factory.go`

```go
package notify

import (
	"encoding/json"
	"fmt"

	"otorem/internal/secret"
	"otorem/internal/store"
)

// NewFromChannel: decrypt config channel → Notifier konkret.
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

- [ ] **Step 3: Route + handler test-send (dengan test)**

Tambahkan di `internal/api/server.go` — tepat setelah baris `apiG.DELETE("/channels/:id", ...)`:

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

// handleChannelTest: kirim pesan tes ke channel — validasi config end-to-end.
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

	// channel tidak ada → 404
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels/999/test", "admin@x.id", ""))
	if w.Code != 404 { t.Errorf("channel hilang: %d", w.Code) }
}
```

- [ ] **Step 4: Run — PASS lalu commit**

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
- Consumes: `store.Store`, `store.NotificationEntry`, `calendarprov.Provider`, `notify.Notifier`, `domain.OccurrencesBetween`, `domain.Saptawara` tidak dipakai di sini
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
	failUntil map[int64]time.Time // channel gagal → skip sampai
	mu        sync.Mutex
}
func (s *Service) RunOnce(ctx context.Context, snap Snapshot) (Result, error)
```

**Semantik RunOnce (dokumen keputusan — ikuti persis):**
1. Waktu kirim reminder ber-tanggal `R` = `R` pukul `SendTime` (timezone Snapshot). Due jika `sendAt ≤ now`.
2. Window catch-up: `dueStart = today@SendTime − CatchUpHours`. `sendAt < dueStart` → catat `missed` (per channel, dedupe). `dueStart ≤ sendAt ≤ now` → kirim; jika `now − sendAt > 1 jam` → pesan diberi label `late`.
3. Rentang scan: `from = today − (maxOffset + ceil(CatchUp/24) + 2 hari)` s.d. `to = today + maxOffset + 2`. Reminder lebih tua dari itu tidak pernah di-record (bounded, tidak menumpuk).
4. Kirim sukses → record `sent`. Kirim gagal → TIDAK di-record (retry scan berikutnya); channel diskip 15 menit via `failUntil`.
5. Channel tujuan per kontak: `prefs.ChannelIDs` (yang enabled & milik owner) — kosong → semua channel enabled milik owner.
6. Hari raya memakai `DefaultOffsets` + `HolidayCategories` filter, key = `HolidayKey(category, h)`.
7. `RunOnce` serial via `mutex`.

- [ ] **Step 1: Tulis test yang gagal**

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

// seed: user@1, contact, otonan base = today-210 (occurrence TEPAT di `today`),
// 1 channel gotify.
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

// hari ini pukul 08:02 UTC → offset H dikirim; H-1..H-7 (4 offset lain) → missed.
func TestRunOnceOnTime(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil { t.Fatal(err) }
	if res.Sent != 1 || res.Failed != 0 || res.Missed != 4 {
		t.Fatalf("res = %+v, want Sent1 Missed4", res)
	}
	if len(h.notif.sent) != 1 { t.Fatalf("notif = %d", len(h.notif.sent)) }
	if strings.Contains(h.notif.sent[0].Body, "terlambat") { t.Error("tidak boleh late") }

	// run ke-2 → semua ter-dedupe
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 || res.Missed != 0 { t.Errorf("dedupe gagal: %+v", res) }
}

// pukul 07:00 → offset H-1 (kemarin 08:00) masih dalam window → kirim late;
// H-2..H-7 → missed; H belum due.
func TestRunOnceCatchUpLate(t *testing.T) {
	now := time.Date(2026, 6, 17, 7, 0, 0, 0, time.UTC)
	h := newHarness(t, now)
	res, err := h.svc.RunOnce(context.Background(), snapUTC())
	if err != nil { t.Fatal(err) }
	if res.Sent != 1 || res.Missed != 3 { t.Fatalf("res = %+v, want Sent1 Missed3", res) }
	if !strings.Contains(h.notif.sent[0].Body, "terlambat") { t.Errorf("harus late: %q", h.notif.sent[0].Body) }
}

// send gagal → tidak recorded → retry setelah backoff 15 menit lewat.
func TestRunOnceRetryAfterFailure(t *testing.T) {
	now := time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.notif.err = context.DeadlineExceeded
	res, _ := h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 1 { t.Fatalf("failed = %d", res.Failed) }

	// 1 menit kemudian: masih dalam backoff → tidak ada attempt
	h.fc.Add(time.Minute)
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Failed != 0 || res.Sent != 0 { t.Errorf("backoff bocor: %+v", res) }

	// 16 menit kemudian + sudah sukses → sent
	h.fc.Add(16 * time.Minute)
	h.notif.err = nil
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 1 { t.Errorf("retry gagal: %+v", res) }
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
	if !found { t.Error("pesan galungan tidak terkirim") }
	// dedupe holiday
	res, _ = h.svc.RunOnce(context.Background(), snapUTC())
	if res.Sent != 0 { t.Errorf("holiday dedupe gagal: %+v", res) }
}

func TestHolidayKey(t *testing.T) {
	got := HolidayKey("pawukon", domain.Holiday{Name: "Batu Kuning"})
	if got != "pawukon:batu-kuning" { t.Errorf("key = %q", got) }
}
```

- [ ] **Step 2: Run — GAGAL**

Run: `go test ./internal/scheduler/ -v`
Expected: FAIL — `Snapshot`/`Service` undefined

- [ ] **Step 3: Implementasi scheduler.go**

```go
// Package scheduler: scan-based reminder engine. Stateless terhadap DB —
// keputusan kirim/missed dihitung tiap scan dari (now, settings, contacts,
// notification_log). Idempotent: aman crash/restart.
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

// targetChannels: channel tujuan satu kontak.
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
	contacts, err := s.St.ListContacts(ctx, 0) // admin scope: semua kontak
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
			// provider remote gagal → lewati; pawukon computed tetap jalan
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
					// holiday → semua channel milik SEMUA user (broadcast)
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
			res.Failed++ // TIDAK di-record → retry scan berikutnya
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

Catatan keputusan yang tersirat di kode (jelaskan ke reviewer bila ditanya):
- Hari raya di-broadcast ke channel SEMUA user (milik siapa pun); occasion hanya ke owner kontak. Untuk 1 keluarga = 1 user, hasilnya identik.
- `missed` di-record per channel supaya dedupe konsisten; counter Prometheus membedakan `kind`.

- [ ] **Step 4: Run — PASS**

Run: `go test ./internal/scheduler/ -v`
Expected: PASS semua. Jika `TestRunOnceCatchUpLate` salah offset (Sent/Missed beda 1): cek `dueStart` — pastikan pakai `sendToday` (today@08:00), bukan `now`.

```bash
gofmt -w internal/ && go vet ./...
git add internal/scheduler/ && git commit -m "feat(scheduler): scan-based runonce dengan dedupe, catch-up, late, backoff"
```

---

### Task 7: Loop ticker + adapter runner di API

**Files:**
- Create: `internal/scheduler/loop.go`
- Create: `internal/api/runner.go`
- Test: `internal/api/runner_test.go`

**Interfaces:**
- Consumes: `api.SchedulerRunner` + `api.RunResult` (Plan 2), `Service.RunOnce`
- Produces: `func (s *Service) Loop(ctx context.Context, every time.Duration, snapshot func(context.Context) (Snapshot, error))`; `type SchedulerRunnerFunc func(ctx context.Context) (RunResult, error)` + method `RunOnce` (adapter agar closure main.go memenuhi interface).

- [ ] **Step 1: Test runner adapter + endpoint (gagal)**

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
	// loop harus berhenti saat ctx cancel — diuji via scheduler package di bawah
}
```
Tambahkan `"strings"` di import bila belum ada.

Tambahkan juga test loop di `internal/scheduler/loop_test.go`:

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
		t.Fatal("loop tidak pernah menjalankan scan")
	}
	cancel()
	// tidak ada cara sinkron menunggu exit tanpa instrumentasi — cukup pastikan
	// tidak panic dan test selesai; race detector yang menjaga.
}
```

- [ ] **Step 2: Run — GAGAL**, lalu implement

`internal/api/runner.go`:

```go
package api

import "context"

// SchedulerRunnerFunc: adapter closure → api.SchedulerRunner (dipakai main.go).
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

// Loop: ticker per menit; snapshot settings diambil tiap iterasi supaya
// perubahan Settings (timezone/jam kirim/catch-up) berlaku tanpa restart.
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

- [ ] **Step 3: Run — PASS lalu commit**

Run: `go test ./internal/scheduler/ ./internal/api/ -v`

```bash
git add internal/ && git commit -m "feat(scheduler+api): loop ticker per menit + runner adapter"
```

---

### Task 8: Provider remote hari raya (dayoffapi + kresnasatya) + cache

**Files:**
- Create: `internal/calendarprov/dayoffapi.go`
- Create: `internal/calendarprov/kresnasatya.go`
- Create: `internal/calendarprov/cached.go`
- Modify: `internal/store/holidaycache.go` (baru — akses tabel holiday_cache)
- Test: `internal/calendarprov/remote_test.go`, `internal/store/holidaycache_test.go`

**Interfaces:**
- Consumes: `calendarprov.Provider`, `store.Store`
- Produces:
```go
func NewDayOffAPI() *DayOffAPI   // Category "national", BaseURL https://dayoffapi.vercel.app, GET /api?year=YYYY
func NewKresna(baseURL string) *Kresna // Category "saka"; baseURL default https://artworks.kresna.me/api-harilibur
type CachedRemote struct{ /* Inner Provider + St *store.Store */ }
func NewCachedRemote(inner Provider, st *store.Store) *CachedRemote // cache-first, refresh jika payload >24 jam, gagal network → pakai stale
func (s *Store) GetHolidayCache(ctx context.Context, year int, source string, dst any) error
func (s *Store) PutHolidayCache(ctx context.Context, year int, source string, v any) error
```

- [ ] **Step 1: VERIFIKASI BENTUK DATA (wajib sebelum koding)**

```bash
curl -s --max-time 15 'https://dayoffapi.vercel.app/api?year=2026' | head -c 600; echo
curl -s --max-time 15 'https://artworks.kresna.me/api-harilibur/api?year=2026' | head -c 600; echo
```
Catat bentuk JSON aktual. Kode di bawah ditulis dengan asumsi:
- dayoffapi: `[{"tanggal":"2026-01-01","keterangan":"...","is_cuti_bersama":false}]`
- kresnasatya: `[{"holiday_date":"2026-...","holiday_name":"..."}]` (atau dibungkus `{"data":[...]}` — sudah di-handle).
**Jika berbeda**: sesuaikan HANYA struct tag/parsing di file ini. **Jika kedua API tidak bisa diakses saat eksekusi**: tetap implement + test dengan httptest (base URL di-inject), tandai smoke remote sebagai manual di README, lanjut — arsitektur tidak tergantung API hidup.

- [ ] **Step 2: Test dengan httptest (gagal)**

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
	if calls != 1 { t.Errorf("remote dipanggil %d×, want 1 (cache-first)", calls) }
}
```
Tambahkan import `"io"` bila gofmt menuntut.

- [ ] **Step 3: Run — GAGAL**, lalu implement

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

// DayOffAPI: libur nasional & cuti bersama Indonesia (termasuk Nyepi).
// Sumber: github.com/gerinsp/dayoff-API (data SKB 3 Menteri).
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

// Kresna: hari libur nasional + daerah Bali (Galungan, Kuningan, Saraswati, dll.).
// Sumber: github.com/kresnasatya/api-harilibur.
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
	// bentuk respons sumber bisa array langsung atau dibungkus {"data":[...]}
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

// CachedRemote: cache-first ke holiday_cache (SQLite). Refresh bila payload
// > 24 jam; jika refetch gagal → pakai cache stale (degrade, jangan mati).
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
	// miss atau stale → coba refresh
	fresh, ferr := c.Inner.HolidaysBetween(ctx, domain.NewDate(y, 1, 1), domain.NewDate(y, 12, 31))
	if ferr == nil {
		_ = c.St.PutHolidayCache(ctx, y, c.Inner.Name(), cachePayload{
			FetchedAt: time.Now(), Holidays: fresh,
		})
		return fresh, true, nil
	}
	if err == nil { // stale cache ada → pakai, jangan gagalkan scheduler
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

- [ ] **Step 4: Run — PASS lalu commit**

Run: `go test ./internal/calendarprov/ ./internal/store/ -v`
(`remote_test.go` sudah meng-include import `io`.)

```bash
git add internal/ && git commit -m "feat(calendarprov): provider remote dayoffapi+kresnasatya dengan cache-first"
```

---

### Task 9: Wiring final main.go + smoke end-to-end

**Files:**
- Modify: `cmd/server/main.go` (tambah scheduler + provider remote)

**Interfaces:**
- Consumes: semua di atas

- [ ] **Step 1: Update main.go**

Ganti body `main` setelah `providers := ...` menjadi:

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
dengan import tambahan: `otorem/internal/notify`, `otorem/internal/scheduler`, `otorem/internal/secret`, `otorem/internal/store`, `otorem/internal/calendarprov`, `"time"`. (Snapshot builder yang sama dipakai dua tempat — ekstrak ke closure lokal `buildSnapshot := func(ctx context.Context) scheduler.Snapshot { ... }` agar DRY.)

- [ ] **Step 2: Build + smoke**

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
Expected: upcoming berisi occasion/hari raya Pawukon (computed selalu ada); scheduler/run mengembalikan JSON `{"sent":..,"failed":..,"missed":..}`; metrics counter ada. Remote API gagal (offline) TIDAK boleh bikin 500 — pastikan log hanya warning/lewati.

- [ ] **Step 3: Commit + tag**

```bash
git add cmd/ && git commit -m "feat(server): wiring scheduler, notifier, provider remote"
git tag plan-3-scheduler-notify-done
```

---

## Definition of Done (Plan 3)

- [ ] `CGO_ENABLED=0 go test ./... -count=1` hijau penuh (unit + integrasi fake-clock).
- [ ] Dedupe: scan 2× tidak mengirim dobel (test `TestRunOnceOnTime` run ke-2).
- [ ] Catch-up: kirim late ≤ 24 jam; > window → `missed`; > lookback → diabaikan.
- [ ] Channel gagal → retry otomatis dengan backoff 15 menit.
- [ ] Tombol test-send channel berfungsi (mock server 200 → 200 OK).
- [ ] Provider remote down ≠ scheduler down (cache-first + stale fallback).
- [ ] Tag `plan-3-scheduler-notify-done`.

**Kontrak untuk Plan 4 (SPA):** endpoint yang dipakai UI: `GET /api/v1/upcoming?days=30`, `GET/POST /api/v1/contacts`, `GET/PATCH/DELETE /api/v1/contacts/:id`, `POST /api/v1/contacts/:id/occasions`, `DELETE /api/v1/occasions/:id`, `PUT /api/v1/contacts/:id/prefs`, `GET/POST /api/v1/channels`, `PATCH/DELETE /api/v1/channels/:id`, `POST /api/v1/channels/:id/test`, `GET/PUT /api/v1/settings`, `GET /api/v1/pawukon?date=`, `GET /api/v1/me`. Dev auth via header `X-Dev-Email`.
