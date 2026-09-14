# otorem Plan 2/4: Store + API + Cloudflare Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete HTTP API (`/api/v1`) on top of SQLite with Cloudflare Access auth (+ dev mode), CRUD for contacts/occasions/channels/settings, an upcoming endpoint, and a computed Pawukon holiday provider.

**Architecture:** Modular monolith: `internal/store` (SQLite + embedded migrations + repositories), `internal/secret` (AES-256-GCM), `internal/calendarprov` (provider interface), `internal/api` (Gin + auth middleware + handlers). `cmd/server/main.go` wires everything together. There is no scheduler in this plan (Plan 3).

**Tech Stack:** Go ≥ 1.23, `github.com/gin-gonic/gin`, `modernc.org/sqlite` (CGO off), `github.com/golang-jwt/jwt/v5` + `github.com/MicahParks/keyfunc/v3` (Cloudflare JWKS), `github.com/prometheus/client_golang`.

## Global Constraints

- `CGO_ENABLED=0` always. `internal/domain` STAYS I/O-free — date parsing needs in the store are handled with local helpers, and the Date JSON serializer arrives as an additive file `internal/domain/datejson.go` (Task 2).
- All endpoints except `/healthz`, `/readyz`, `/metrics` must pass through the auth middleware.
- Channel config is NEVER sent back to the client (only `{id,type,name,enabled}`).
- API error language: short Indonesian, field `{"error": "..."}`.
- Dev mode (`AUTH_MODE=dev`) may only be enabled through an explicit env var; the middleware rejects requests without `X-Dev-Email`.
- TDD: test first → red → implement → green → commit (`feat:`/`test:`). Type/function names MUST match the "Interfaces" blocks exactly (Plans 3 & 4 consume them).
- Adding dependencies beyond those listed in Tech Stack is forbidden without a strong reason.

**Consumed from Plan 1 (internal/domain):** `Date`, `NewDate`, `DateFromTime`, `Date.String()`, `Date.JDN()`, `Date.AddDays`, `Pawukon`, `PawukonDate.Label()`, `OccurrencesBetween`, `OccurrenceType` (`Birthday`/`Otonan`/`Anniversary`), `PawukonHolidaysBetween`, `DefaultOffsets`, `ValidateOffsets`.

---

### Task 1: Dependencies + config package

**Files:**
- Modify: `go.mod` (module `otorem` already exists from Plan 1)
- Create: `internal/config/config.go`
- Test: `internal/config/config_test.go`

**Interfaces:**
- Produces: `package config` — `const AuthCFAccess = "cfaccess"`, `const AuthDev = "dev"`; `type Config struct{ Addr, DataDir, AppSecret, AuthMode, CFTeamDomain, CFAud, TZ string; AdminEmails map[string]bool }`; `func Load() (Config, error)`; `func (c Config) DBPath() string` (= `DataDir/otorem.db`).

- [ ] **Step 1: Install dependencies**

```bash
cd code && go get github.com/gin-gonic/gin@latest modernc.org/sqlite@latest github.com/golang-jwt/jwt/v5@latest github.com/MicahParks/keyfunc/v3@latest github.com/prometheus/client_golang@latest
```

- [ ] **Step 2: Write the failing test**

`internal/config/config_test.go`:

```go
package config

import (
	"os"
	"testing"
)

func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv { os.Setenv(k, v) }
	t.Cleanup(func() { for k := range kv { os.Unsetenv(k) } })
}

func validEnv() map[string]string {
	return map[string]string{
		"APP_SECRET": "super-secret-panjang-16",
		"CF_ACCESS_TEAM_DOMAIN": "contoh.cloudflareaccess.com",
		"CF_ACCESS_AUD": "abc.access",
		"ADMIN_EMAILS": "Admin@X.com, user@y.com",
	}
}

func TestLoadValid(t *testing.T) {
	setEnv(t, validEnv())
	c, err := Load()
	if err != nil { t.Fatal(err) }
	if c.Addr != ":8080" { t.Errorf("Addr default = %q", c.Addr) }
	if c.DBPath() != "./data/otorem.db" { t.Errorf("DBPath = %q", c.DBPath()) }
	if !c.AdminEmails["admin@x.com"] { t.Errorf("admin email must be lowercased: %v", c.AdminEmails) }
}

func TestLoadRejectsShortSecret(t *testing.T) {
	setEnv(t, map[string]string{"APP_SECRET": "pendek"})
	if _, err := Load(); err == nil { t.Error("short secret must error") }
}

func TestLoadCFAccessRequiresTeamAndAud(t *testing.T) {
	setEnv(t, map[string]string{"APP_SECRET": "super-secret-panjang-16"})
	if _, err := Load(); err == nil { t.Error("cfaccess without team/aud must error") }
}

func TestLoadDevModeOK(t *testing.T) {
	setEnv(t, map[string]string{"APP_SECRET": "super-secret-panjang-16", "AUTH_MODE": "dev"})
	if _, err := Load(); err != nil { t.Errorf("dev mode without CF env must be valid: %v", err) }
}
```

- [ ] **Step 3: Run — FAIL**

Run: `go test ./internal/config/ -v`
Expected: FAIL — `Load undefined`

- [ ] **Step 4: Implementation**

`internal/config/config.go`:

```go
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

const (
	AuthCFAccess = "cfaccess"
	AuthDev      = "dev"
)

type Config struct {
	Addr         string
	DataDir      string
	AppSecret    string
	AuthMode     string
	CFTeamDomain string
	CFAud        string
	AdminEmails  map[string]bool
	TZ           string
}

func Load() (Config, error) {
	c := Config{
		Addr:         envOr("ADDR", ":8080"),
		DataDir:      envOr("DATA_DIR", "./data"),
		AppSecret:    os.Getenv("APP_SECRET"),
		AuthMode:     envOr("AUTH_MODE", AuthCFAccess),
		CFTeamDomain: os.Getenv("CF_ACCESS_TEAM_DOMAIN"),
		CFAud:        os.Getenv("CF_ACCESS_AUD"),
		TZ:           envOr("TZ", "Asia/Jakarta"),
		AdminEmails:  map[string]bool{},
	}
	for _, e := range strings.Split(os.Getenv("ADMIN_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails[e] = true
		}
	}
	if c.AuthMode != AuthCFAccess && c.AuthMode != AuthDev {
		return c, fmt.Errorf("AUTH_MODE harus %q atau %q", AuthCFAccess, AuthDev)
	}
	if len(c.AppSecret) < 16 {
		return c, errors.New("APP_SECRET wajib terisi, minimal 16 karakter (kunci AES-256-GCM)")
	}
	if c.AuthMode == AuthCFAccess && (c.CFTeamDomain == "" || c.CFAud == "") {
		return c, errors.New("AUTH_MODE=cfaccess membutuhkan CF_ACCESS_TEAM_DOMAIN dan CF_ACCESS_AUD")
	}
	return c, nil
}

func (c Config) DBPath() string { return c.DataDir + "/otorem.db" }

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" { return v }
	return d
}
```

- [ ] **Step 5: Run — PASS, then commit**

Run: `go test ./internal/config/ -v`
Expected: PASS

```bash
git add go.mod go.sum internal/config/ && git commit -m "feat(config): env config loader dengan validasi auth mode"
```

---

### Task 2: Embedded migrations + store.Open + Date JSON

**Files:**
- Create: `internal/store/store.go`
- Create: `internal/store/migrate.go`
- Create: `internal/store/migrations/001_init.sql`
- Create: `internal/domain/datejson.go` (additive to domain — serializer only, logic stays in Plan 1)
- Test: `internal/store/store_test.go`, `internal/domain/datejson_test.go`

**Interfaces:**
- Consumes: `domain.Date`
- Produces: `package store` — `type Store struct{}` (field `db *sql.DB`, unexported); `func Open(path string) (*Store, error)`; `func OpenInMemory() (*Store, error)`; `func (s *Store) Migrate() error`; `func (s *Store) Close() error`; `func (s *Store) Ping(ctx context.Context) error`; `var ErrNotFound = errors.New("not found")`. And in domain: `func ParseDate(s string) (Date, error)`; `(Date) MarshalJSON() ([]byte, error)`; `(Date) UnmarshalJSON(b []byte) error` (format `"2006-01-02"`).

- [ ] **Step 1: Domain JSON test (failing)**

`internal/domain/datejson_test.go`:

```go
package domain

import (
	"encoding/json"
	"testing"
)

func TestDateJSONRoundTrip(t *testing.T) {
	d := NewDate(2026, 6, 17)
	b, err := json.Marshal(d)
	if err != nil { t.Fatal(err) }
	if string(b) != `"2026-06-17"` { t.Errorf("marshal = %s", b) }
	var back Date
	if err := json.Unmarshal(b, &back); err != nil { t.Fatal(err) }
	if back != d { t.Errorf("unmarshal = %s", back) }
	if _, err := ParseDate("2026-06-17"); err != nil { t.Errorf("ParseDate: %v", err) }
	if _, err := ParseDate("17-06-2026"); err == nil { t.Error("wrong format must error") }
}
```

- [ ] **Step 2: Run — FAIL**, then implement `internal/domain/datejson.go`

```go
package domain

import "fmt"

// ParseDate parses "YYYY-MM-DD" (civil).
func ParseDate(s string) (Date, error) {
	var y, m, d int
	if _, err := fmt.Sscanf(s, "%d-%d-%d", &y, &m, &d); err != nil {
		return Date{}, fmt.Errorf("tanggal harus format YYYY-MM-DD: %q", s)
	}
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return Date{}, fmt.Errorf("tanggal tidak valid: %q", s)
	}
	return Date{Year: y, Month: m, Day: d}, nil
}

func (d Date) MarshalJSON() ([]byte, error) { return []byte(`"` + d.String() + `"`), nil }

func (d *Date) UnmarshalJSON(b []byte) error {
	if len(b) < 2 { return fmt.Errorf("tanggal JSON kosong") }
	parsed, err := ParseDate(string(b[1 : len(b)-1]))
	if err != nil { return err }
	*d = parsed
	return nil
}
```

Run: `go test ./internal/domain/ -run DateJSON -v` → PASS.

- [ ] **Step 3: SQL schema (spec §4)**

`internal/store/migrations/001_init.sql`:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contacts_owner ON contacts(owner_id);

CREATE TABLE occasions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('birthday','otonan','anniversary')),
  base_date TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_occasions_contact ON occasions(contact_id);

CREATE TABLE reminder_prefs (
  contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  offsets TEXT NOT NULL,
  channel_ids TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('gotify','telegram','email')),
  name TEXT NOT NULL,
  config_enc BLOB NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occasion_id INTEGER REFERENCES occasions(id) ON DELETE SET NULL,
  holiday_key TEXT,
  occurrence_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','missed')),
  error TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_log_occasion ON notification_log(occasion_id, occurrence_date, offset_days, channel_id) WHERE occasion_id IS NOT NULL;
CREATE UNIQUE INDEX uq_log_holiday ON notification_log(holiday_key, occurrence_date, offset_days, channel_id) WHERE holiday_key IS NOT NULL;
CREATE INDEX idx_log_sent_at ON notification_log(sent_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE holiday_cache (
  year INTEGER NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (year, source)
);
```

- [ ] **Step 4: Store test (failing)**

`internal/store/store_test.go`:

```go
package store

import (
	"context"
	"testing"
)

func TestOpenInMemoryAndMigrate(t *testing.T) {
	s, err := OpenInMemory()
	if err != nil { t.Fatal(err) }
	defer s.Close()
	if err := s.Migrate(); err != nil { t.Fatalf("migrate: %v", err) }
	// idempotent
	if err := s.Migrate(); err != nil { t.Fatalf("migrate ke-2: %v", err) }
	if err := s.Ping(context.Background()); err != nil { t.Fatalf("ping: %v", err) }
}

func TestForeignKeysActive(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	_ = s.Migrate()
	_, err := s.db.Exec(`INSERT INTO contacts (owner_id, name) VALUES (999, 'x')`)
	if err == nil { t.Error("FK disabled — a contact without a user must be rejected") }
}
```

- [ ] **Step 5: Implement store.go + migrate.go**

`internal/store/store.go`:

```go
package store

import (
	"context"
	"database/sql"
	"errors"

	_ "modernc.org/sqlite" // driver "sqlite", pure-Go
)

var ErrNotFound = errors.New("not found")

type Store struct{ db *sql.DB }

const pragmas = `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil { return nil, err }
	if _, err := db.Exec(pragmas); err != nil { db.Close(); return nil, err }
	return &Store{db: db}, nil
}

// OpenInMemory: used by tests — a single shared DB via cache=shared.
func OpenInMemory() (*Store, error) {
	db, err := sql.Open("sqlite", "file:otoremtest?mode=memory&cache=shared")
	if err != nil { return nil, err }
	if _, err := db.Exec(pragmas); err != nil { db.Close(); return nil, err }
	return &Store{db: db}, nil
}

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) Close() error                   { return s.db.Close() }
```

`internal/store/migrate.go`:

```go
package store

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func (s *Store) Migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now'))) `); err != nil {
		return err
	}
	entries, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil { return err }
	sort.Strings(entries)
	var current int
	if err := s.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM schema_migrations`).Scan(&current); err != nil {
		return err
	}
	for _, e := range entries {
		v, err := strconv.Atoi(strings.TrimSuffix(path.Base(e), ".sql"))
		if err != nil { return fmt.Errorf("nama migrasi harus NNN_*.sql: %s", e) }
		if v <= current { continue }
		body, err := migrationsFS.ReadFile(e)
		if err != nil { return err }
		tx, err := s.db.Begin()
		if err != nil { return err }
		if _, err := tx.Exec(string(body)); err != nil { tx.Rollback(); return fmt.Errorf("%s: %w", e, err) }
		if _, err := tx.Exec(`INSERT INTO schema_migrations(version) VALUES (?)`, v); err != nil {
			tx.Rollback(); return err
		}
		if err := tx.Commit(); err != nil { return err }
	}
	return nil
}
```

- [ ] **Step 6: Run — PASS, then commit**

Run: `go test ./internal/store/ ./internal/domain/ -v`
Expected: PASS

```bash
git add internal/ && git commit -m "feat(store): embedded migrations, WAL sqlite open, date JSON serializers"
```

---

### Task 3: Channel config encryption (AES-256-GCM)

**Files:**
- Create: `internal/secret/secret.go`
- Test: `internal/secret/secret_test.go`

**Interfaces:**
- Produces: `package secret` — `func DeriveKey(appSecret string) []byte` (SHA-256 → 32 bytes); `func Encrypt(key, plaintext []byte) ([]byte, error)`; `func Decrypt(key, blob []byte) ([]byte, error)` (format: nonce ‖ ciphertext, AES-256-GCM).

- [ ] **Step 1: Test (failing)**

`internal/secret/secret_test.go`:

```go
package secret

import (
	"bytes"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	key := DeriveKey("super-secret-panjang-16")
	plain := []byte(`{"token":"rahasia"}`)
	blob, err := Encrypt(key, plain)
	if err != nil { t.Fatal(err) }
	if bytes.Contains(blob, plain) { t.Error("plaintext must not be visible in the blob") }
	got, err := Decrypt(key, blob)
	if err != nil { t.Fatal(err) }
	if !bytes.Equal(got, plain) { t.Errorf("got %q", got) }
}

func TestTamperFails(t *testing.T) {
	key := DeriveKey("super-secret-panjang-16")
	blob, _ := Encrypt(key, []byte("data"))
	blob[len(blob)-1] ^= 0xFF
	if _, err := Decrypt(key, blob); err == nil { t.Error("a modified blob must fail auth") }
}

func TestWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt(DeriveKey("kunci-satu-panjang-16"), []byte("data"))
	if _, err := Decrypt(DeriveKey("kunci-dua-panjang-16"), blob); err == nil {
		t.Error("wrong key must fail")
	}
}
```

- [ ] **Step 2: Run — FAIL**, then implement

`internal/secret/secret.go`:

```go
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
)

// DeriveKey: APP_SECRET string env → 32-byte key for AES-256-GCM.
func DeriveKey(appSecret string) []byte {
	k := sha256.Sum256([]byte(appSecret))
	return k[:]
}

func Encrypt(key, plaintext []byte) ([]byte, error) {
	gcm, err := gcm(key)
	if err != nil { return nil, err }
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil { return nil, err }
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func Decrypt(key, blob []byte) ([]byte, error) {
	gcm, err := gcm(key)
	if err != nil { return nil, err }
	if len(blob) < gcm.NonceSize() { return nil, errors.New("blob terlalu pendek") }
	return gcm.Open(nil, blob[:gcm.NonceSize()], blob[gcm.NonceSize():], nil)
}

func gcm(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 { return nil, fmt.Errorf("kunci harus 32 byte, dapat %d", len(key)) }
	block, err := aes.NewCipher(key)
	if err != nil { return nil, err }
	return cipher.NewGCM(block)
}
```

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/secret/ -v`

```bash
git add internal/secret/ && git commit -m "feat(secret): aes-256-gcm encrypt/decrypt untuk config channel"
```

---

### Task 4: Repositories for users, contacts, occasions, prefs

**Files:**
- Create: `internal/store/users.go`
- Create: `internal/store/contacts.go`
- Test: `internal/store/users_test.go`, `internal/store/contacts_test.go`

**Interfaces:**
- Consumes: `store.Store`, `domain.Date`, `domain.OccurrenceType`
- Produces:
```go
type User struct{ ID int64; Email, Name, Role string }
func (s *Store) GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (User, error)
func (s *Store) ListUsers(ctx context.Context) ([]User, error)

type Contact struct{ ID, OwnerID int64; Name, Nickname, Notes string }
type Occasion struct{ ID, ContactID int64; Type domain.OccurrenceType; BaseDate domain.Date; Label string }
type ReminderPrefs struct{ ContactID int64; Offsets []int; ChannelIDs []int64; Enabled bool }
type ContactWithOccasions struct { Contact; Occasions []Occasion; Prefs *ReminderPrefs }

func (s *Store) CreateContact(ctx context.Context, ownerID int64, name, nickname, notes string) (Contact, error)
func (s *Store) ListContacts(ctx context.Context, ownerID int64) ([]ContactWithOccasions, error) // ownerID 0 = all (admin)
func (s *Store) GetContact(ctx context.Context, ownerID, contactID int64) (*ContactWithOccasions, error) // ownerID 0 = bypass
func (s *Store) UpdateContact(ctx context.Context, ownerID, contactID int64, name, nickname, notes string) error
func (s *Store) DeleteContact(ctx context.Context, ownerID, contactID int64) error
func (s *Store) AddOccasion(ctx context.Context, contactID int64, typ domain.OccurrenceType, base domain.Date, label string) (Occasion, error)
func (s *Store) DeleteOccasion(ctx context.Context, id int64) error
func (s *Store) SetReminderPrefs(ctx context.Context, p ReminderPrefs) error
```

- [ ] **Step 1: Users test (failing)**

`internal/store/users_test.go`:

```go
package store

import (
	"context"
	"testing"
)

func TestGetOrCreateUser(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	admins := map[string]bool{"budi@x.id": true}
	u1, err := s.GetOrCreateUser(ctx, "Budi@X.id", "Budi", admins)
	if err != nil { t.Fatal(err) }
	if u1.Role != "admin" { t.Errorf("role = %q, want admin", u1.Role) }
	u2, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi Lain", admins) // same email → no dup
	if u2.ID != u1.ID { t.Errorf("duplicate user: %d vs %d", u1.ID, u2.ID) }
	u3, _ := s.GetOrCreateUser(ctx, "citra@x.id", "Citra", admins)
	if u3.Role != "member" { t.Errorf("non-admin role = %q", u3.Role) }
	users, _ := s.ListUsers(ctx)
	if len(users) != 2 { t.Errorf("user count = %d, want 2", len(users)) }
}
```

- [ ] **Step 2: Run — FAIL**, then implement `internal/store/users.go`

```go
package store

import (
	"context"
	"strings"
)

type User struct {
	ID    int64
	Email string
	Name  string
	Role  string
}

// GetOrCreateUser: auto-provision from the email claim. Role is only set on create.
func (s *Store) GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	role := "member"
	if adminEmails[email] { role = "admin" }
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO users (email, name, role) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING`,
		email, name, role); err != nil {
		return User{}, err
	}
	var u User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, role FROM users WHERE email = ?`, email).
		Scan(&u.ID, &u.Email, &u.Name, &u.Role)
	return u, err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, email, name, role FROM users ORDER BY id`)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role); err != nil { return nil, err }
		out = append(out, u)
	}
	return out, rows.Err()
}
```

- [ ] **Step 3: Contacts test (failing)**

`internal/store/contacts_test.go`:

```go
package store

import (
	"context"
	"testing"

	"otorem/internal/domain"
)

func seedContact(t *testing.T, s *Store) (User, ContactWithOccasions) {
	t.Helper()
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, err := s.CreateContact(ctx, u.ID, "Made Wijaya", "Made", "sepupu")
	if err != nil { t.Fatal(err) }
	if _, err := s.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(1990, 5, 12), ""); err != nil { t.Fatal(err) }
	if _, err := s.AddOccasion(ctx, c.ID, domain.Birthday, domain.NewDate(1990, 5, 20), ""); err != nil { t.Fatal(err) }
	if err := s.SetReminderPrefs(ctx, ReminderPrefs{ContactID: c.ID, Offsets: []int{1, 0}, ChannelIDs: []int64{}, Enabled: true}); err != nil { t.Fatal(err) }
	cw, err := s.GetContact(ctx, u.ID, c.ID)
	if err != nil { t.Fatal(err) }
	return u, *cw
}

func TestContactCRUD(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	u, cw := seedContact(t, s)
	if len(cw.Occasions) != 2 { t.Fatalf("occasions = %d", len(cw.Occasions)) }
	if cw.Prefs == nil || len(cw.Prefs.Offsets) != 2 { t.Fatalf("prefs wrong: %+v", cw.Prefs) }
	if cw.Nickname != "Made" { t.Errorf("nickname = %q", cw.Nickname) }

	if err := s.UpdateContact(context.Background(), u.ID, cw.ID, "Made W.", "", "catatan baru"); err != nil { t.Fatal(err) }
	ls, _ := s.ListContacts(context.Background(), u.ID)
	if ls[0].Name != "Made W." { t.Errorf("update failed: %q", ls[0].Name) }

	// another owner cannot see it
	v, _ := s.GetOrCreateUser(context.Background(), "lain@x.id", "Lain", nil)
	if _, err := s.GetContact(context.Background(), v.ID, cw.ID); err == nil {
		t.Error("accessing another user's contact must error")
	}
	// admin (ownerID 0) can
	if _, err := s.GetContact(context.Background(), 0, cw.ID); err != nil {
		t.Errorf("admin must have access: %v", err)
	}

	if err := s.DeleteContact(context.Background(), u.ID, cw.ID); err != nil { t.Fatal(err) }
	ls, _ = s.ListContacts(context.Background(), u.ID)
	if len(ls) != 0 { t.Errorf("delete failed: %d left", len(ls)) }
}

func TestAddOccasionValidatesType(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	u, _ := s.GetOrCreateUser(context.Background(), "budi@x.id", "Budi", nil)
	c, _ := s.CreateContact(context.Background(), u.ID, "X", "", "")
	if _, err := s.AddOccasion(context.Background(), c.ID, "salfok", domain.NewDate(2000, 1, 1), ""); err == nil {
		t.Error("an illegal type must be rejected")
	}
}
```

- [ ] **Step 4: Run — FAIL**, then implement `internal/store/contacts.go`

```go
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"otorem/internal/domain"
)

type Contact struct {
	ID       int64
	OwnerID  int64
	Name     string
	Nickname string
	Notes    string
}

type Occasion struct {
	ID        int64
	ContactID int64
	Type      domain.OccurrenceType
	BaseDate  domain.Date
	Label     string
}

type ReminderPrefs struct {
	ContactID  int64
	Offsets    []int
	ChannelIDs []int64
	Enabled    bool
}

type ContactWithOccasions struct {
	Contact
	Occasions []Occasion
	Prefs     *ReminderPrefs
}

func (s *Store) CreateContact(ctx context.Context, ownerID int64, name, nickname, notes string) (Contact, error) {
	r, err := s.db.ExecContext(ctx,
		`INSERT INTO contacts (owner_id, name, nickname, notes) VALUES (?,?,?,?)`,
		ownerID, name, nickname, notes)
	if err != nil { return Contact{}, err }
	id, _ := r.LastInsertId()
	return Contact{ID: id, OwnerID: ownerID, Name: name, Nickname: nickname, Notes: notes}, nil
}

func ownerFilter(ownerID int64) string {
	if ownerID == 0 { return "1=1" } // admin
	return fmt.Sprintf("owner_id = %d", ownerID)
}

func (s *Store) ListContacts(ctx context.Context, ownerID int64) ([]ContactWithOccasions, error) {
	q := fmt.Sprintf(`SELECT id, owner_id, name, nickname, notes FROM contacts WHERE %s ORDER BY name`, ownerFilter(ownerID))
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []ContactWithOccasions
	for rows.Next() {
		var c ContactWithOccasions
		if err := rows.Scan(&c.ID, &c.OwnerID, &c.Name, &c.Nickname, &c.Notes); err != nil { return nil, err }
		out = append(out, c)
	}
	if err := rows.Err(); err != nil { return nil, err }
	for i := range out {
		if err := s.fill(ctx, &out[i]); err != nil { return nil, err }
	}
	return out, nil
}

func (s *Store) GetContact(ctx context.Context, ownerID, contactID int64) (*ContactWithOccasions, error) {
	q := fmt.Sprintf(`SELECT id, owner_id, name, nickname, notes FROM contacts WHERE id = ? AND %s`, ownerFilter(ownerID))
	c := &ContactWithOccasions{}
	err := s.db.QueryRowContext(ctx, q, contactID).Scan(&c.ID, &c.OwnerID, &c.Name, &c.Nickname, &c.Notes)
	if errors.Is(err, sql.ErrNoRows) { return nil, ErrNotFound }
	if err != nil { return nil, err }
	if err := s.fill(ctx, c); err != nil { return nil, err }
	return c, nil
}

func (s *Store) fill(ctx context.Context, c *ContactWithOccasions) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, contact_id, type, base_date, label FROM occasions WHERE contact_id = ? ORDER BY base_date`, c.ID)
	if err != nil { return err }
	defer rows.Close()
	for rows.Next() {
		var o Occasion
		var base string
		if err := rows.Scan(&o.ID, &o.ContactID, &o.Type, &base, &o.Label); err != nil { return err }
		if o.BaseDate, err = domain.ParseDate(base); err != nil { return err }
		c.Occasions = append(c.Occasions, o)
	}
	if err := rows.Err(); err != nil { return err }

	var offsets, channelIDs string
	var enabled int
	err = s.db.QueryRowContext(ctx,
		`SELECT offsets, channel_ids, enabled FROM reminder_prefs WHERE contact_id = ?`, c.ID).
		Scan(&offsets, &channelIDs, &enabled)
	if errors.Is(err, sql.ErrNoRows) { return nil }
	if err != nil { return err }
	p := &ReminderPrefs{ContactID: c.ID, Enabled: enabled == 1}
	if err := json.Unmarshal([]byte(offsets), &p.Offsets); err != nil { return err }
	if err := json.Unmarshal([]byte(channelIDs), &p.ChannelIDs); err != nil { return err }
	c.Prefs = p
	return nil
}

func (s *Store) UpdateContact(ctx context.Context, ownerID, contactID int64, name, nickname, notes string) error {
	r, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`UPDATE contacts SET name=?, nickname=?, notes=? WHERE id = ? AND %s`, ownerFilter(ownerID)),
		name, nickname, notes, contactID)
	if err != nil { return err }
	if n, _ := r.RowsAffected(); n == 0 { return ErrNotFound }
	return nil
}

func (s *Store) DeleteContact(ctx context.Context, ownerID, contactID int64) error {
	r, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM contacts WHERE id = ? AND %s`, ownerFilter(ownerID)), contactID)
	if err != nil { return err }
	if n, _ := r.RowsAffected(); n == 0 { return ErrNotFound }
	return nil
}

func (s *Store) AddOccasion(ctx context.Context, contactID int64, typ domain.OccurrenceType, base domain.Date, label string) (Occasion, error) {
	if typ != domain.Birthday && typ != domain.Otonan && typ != domain.Anniversary {
		return Occasion{}, fmt.Errorf("tipe occasion tidak dikenal: %q", typ)
	}
	r, err := s.db.ExecContext(ctx,
		`INSERT INTO occasions (contact_id, type, base_date, label) VALUES (?,?,?,?)`,
		contactID, typ, base.String(), label)
	if err != nil { return Occasion{}, err }
	id, _ := r.LastInsertId()
	return Occasion{ID: id, ContactID: contactID, Type: typ, BaseDate: base, Label: label}, nil
}

func (s *Store) DeleteOccasion(ctx context.Context, id int64) error {
	r, err := s.db.ExecContext(ctx, `DELETE FROM occasions WHERE id = ?`, id)
	if err != nil { return err }
	if n, _ := r.RowsAffected(); n == 0 { return ErrNotFound }
	return nil
}

func (s *Store) SetReminderPrefs(ctx context.Context, p ReminderPrefs) error {
	off, err := json.Marshal(p.Offsets)
	if err != nil { return err }
	ch, err := json.Marshal(p.ChannelIDs)
	if err != nil { return err }
	_, err = s.db.ExecContext(ctx, `INSERT INTO reminder_prefs (contact_id, offsets, channel_ids, enabled)
		VALUES (?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET offsets=excluded.offsets,
		channel_ids=excluded.channel_ids, enabled=excluded.enabled`,
		p.ContactID, string(off), string(ch), boolInt(p.Enabled))
	return err
}

func boolInt(b bool) int { if b { return 1 }; return 0 }
```

- [ ] **Step 5: Run — PASS, then commit**

Run: `go test ./internal/store/ -v`

```bash
git add internal/store/ && git commit -m "feat(store): users, contacts, occasions, reminder prefs repositories"
```

---

### Task 5: Repositories for channels, settings, notification_log (dedupe)

**Files:**
- Create: `internal/store/channels.go`
- Create: `internal/store/settings.go`
- Create: `internal/store/log.go`
- Test: `internal/store/log_test.go` (channels/settings are tested via log_test + contacts_test following the same pattern — include both test files)

**Interfaces:**
- Produces:
```go
type Channel struct{ ID, OwnerID int64; Type, Name string; ConfigEnc []byte; Enabled bool }
func (s *Store) CreateChannel(ctx context.Context, ownerID int64, typ, name string, configEnc []byte) (Channel, error)
func (s *Store) ListChannels(ctx context.Context, ownerID int64) ([]Channel, error) // 0 = all
func (s *Store) GetChannel(ctx context.Context, ownerID, id int64) (*Channel, error)
func (s *Store) SetChannelEnabled(ctx context.Context, ownerID, id int64, enabled bool) error
func (s *Store) DeleteChannel(ctx context.Context, ownerID, id int64) error

func (s *Store) GetSettingJSON(ctx context.Context, key string, dst any) error // ErrNotFound if absent
func (s *Store) PutSettingJSON(ctx context.Context, key string, v any) error

type NotificationEntry struct {
	OccasionID     *int64  // exactly one of OccasionID/HolidayKey is required
	HolidayKey     *string
	OccurrenceDate domain.Date
	OffsetDays     int
	ChannelID      int64
	Status         string // "sent" | "failed" | "missed"
	Error          string
}
func (s *Store) RecordNotification(ctx context.Context, e NotificationEntry) (inserted bool, err error) // INSERT OR IGNORE
```

- [ ] **Step 1: Test — especially dedupe (failing)**

`internal/store/log_test.go`:

```go
package store

import (
	"context"
	"testing"

	"otorem/internal/domain"
)

func TestRecordNotificationDedupe(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	c, _ := s.CreateContact(ctx, u.ID, "Made", "", "")
	oc, _ := s.AddOccasion(ctx, c.ID, domain.Otonan, domain.NewDate(1990, 5, 12), "")
	ch, _ := s.CreateChannel(ctx, u.ID, "gotify", "rumah", []byte("enc"))
	occID := oc.ID
	e := NotificationEntry{OccasionID: &occID, OccurrenceDate: domain.NewDate(2026, 6, 17),
		OffsetDays: 7, ChannelID: ch.ID, Status: "sent"}

	inserted, err := s.RecordNotification(ctx, e)
	if err != nil || !inserted { t.Fatalf("first: inserted=%v err=%v", inserted, err) }
	inserted, err = s.RecordNotification(ctx, e)
	if err != nil { t.Fatal(err) }
	if inserted { t.Error("a double send must be deduped (inserted=false)") }
}

func TestHolidayDedupeIndependent(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	u, _ := s.GetOrCreateUser(ctx, "budi@x.id", "Budi", nil)
	ch, _ := s.CreateChannel(ctx, u.ID, "telegram", "grup", []byte("enc"))
	hk := "pawukon:galungan"
	_, _ = s.RecordNotification(ctx, NotificationEntry{HolidayKey: &hk,
		OccurrenceDate: domain.NewDate(2026, 6, 17), OffsetDays: 7, ChannelID: ch.ID, Status: "sent"})
	inserted, err := s.RecordNotification(ctx, NotificationEntry{HolidayKey: &hk,
		OccurrenceDate: domain.NewDate(2026, 6, 17), OffsetDays: 7, ChannelID: ch.ID, Status: "missed"})
	if err != nil || inserted { t.Errorf("holiday dedupe failed: inserted=%v err=%v", inserted, err) }
}

func TestSettingsRoundTrip(t *testing.T) {
	s, _ := OpenInMemory()
	defer s.Close()
	ctx := context.Background()
	var v map[string]any
	if err := s.GetSettingJSON(ctx, "tidak_ada", &v); err != ErrNotFound {
		t.Errorf("an absent setting must be ErrNotFound, got %v", err)
	}
	in := map[string]any{"timezone": "Asia/Makassar", "n": float64(2)}
	if err := s.PutSettingJSON(ctx, "tz", in); err != nil { t.Fatal(err) }
	var out map[string]any
	if err := s.GetSettingJSON(ctx, "tz", &out); err != nil { t.Fatal(err) }
	if out["timezone"] != "Asia/Makassar" { t.Errorf("got %v", out) }
}
```

- [ ] **Step 2: Run — FAIL**, then implement the three files

`internal/store/channels.go`:

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type Channel struct {
	ID        int64
	OwnerID   int64
	Type      string
	Name      string
	ConfigEnc []byte
	Enabled   bool
}

func (s *Store) CreateChannel(ctx context.Context, ownerID int64, typ, name string, configEnc []byte) (Channel, error) {
	if typ != "gotify" && typ != "telegram" && typ != "email" {
		return Channel{}, fmt.Errorf("tipe channel tidak dikenal: %q", typ)
	}
	r, err := s.db.ExecContext(ctx,
		`INSERT INTO channels (owner_id, type, name, config_enc, enabled) VALUES (?,?,?,?,1)`,
		ownerID, typ, name, configEnc)
	if err != nil { return Channel{}, err }
	id, _ := r.LastInsertId()
	return Channel{ID: id, OwnerID: ownerID, Type: typ, Name: name, ConfigEnc: configEnc, Enabled: true}, nil
}

func (s *Store) ListChannels(ctx context.Context, ownerID int64) ([]Channel, error) {
	q := `SELECT id, owner_id, type, name, config_enc, enabled FROM channels`
	args := []any{}
	if ownerID != 0 { q += ` WHERE owner_id = ?`; args = append(args, ownerID) }
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []Channel
	for rows.Next() {
		var c Channel
		var en int
		if err := rows.Scan(&c.ID, &c.OwnerID, &c.Type, &c.Name, &c.ConfigEnc, &en); err != nil { return nil, err }
		c.Enabled = en == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetChannel(ctx context.Context, ownerID, id int64) (*Channel, error) {
	q := `SELECT id, owner_id, type, name, config_enc, enabled FROM channels WHERE id = ?`
	args := []any{id}
	if ownerID != 0 { q += ` AND owner_id = ?`; args = append(args, ownerID) }
	c := &Channel{}
	var en int
	err := s.db.QueryRowContext(ctx, q, args...).Scan(&c.ID, &c.OwnerID, &c.Type, &c.Name, &c.ConfigEnc, &en)
	if errors.Is(err, sql.ErrNoRows) { return nil, ErrNotFound }
	if err != nil { return nil, err }
	c.Enabled = en == 1
	return c, nil
}

func (s *Store) SetChannelEnabled(ctx context.Context, ownerID, id int64, enabled bool) error {
	r, err := s.db.ExecContext(ctx, `UPDATE channels SET enabled = ? WHERE id = ? AND owner_id = ?`,
		boolInt(enabled), id, ownerID)
	if err != nil { return err }
	if n, _ := r.RowsAffected(); n == 0 { return ErrNotFound }
	return nil
}

func (s *Store) DeleteChannel(ctx context.Context, ownerID, id int64) error {
	r, err := s.db.ExecContext(ctx, `DELETE FROM channels WHERE id = ? AND owner_id = ?`, id, ownerID)
	if err != nil { return err }
	if n, _ := r.RowsAffected(); n == 0 { return ErrNotFound }
	return nil
}
```

`internal/store/settings.go`:

```go
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func (s *Store) GetSettingJSON(ctx context.Context, key string, dst any) error {
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) { return ErrNotFound }
	if err != nil { return err }
	return json.Unmarshal([]byte(raw), dst)
}

func (s *Store) PutSettingJSON(ctx context.Context, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil { return err }
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, string(b))
	return err
}
```

`internal/store/log.go`:

```go
package store

import (
	"context"

	"otorem/internal/domain"
)

type NotificationEntry struct {
	OccasionID     *int64
	HolidayKey     *string
	OccurrenceDate domain.Date
	OffsetDays     int
	ChannelID      int64
	Status         string
	Error          string
}

// RecordNotification: INSERT OR IGNORE — dedupe against double sends.
// Returns inserted=true only when the row is genuinely new.
func (s *Store) RecordNotification(ctx context.Context, e NotificationEntry) (bool, error) {
	r, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO notification_log
		(occasion_id, holiday_key, occurrence_date, offset_days, channel_id, status, error)
		VALUES (?,?,?,?,?,?,?)`,
		e.OccasionID, e.HolidayKey, e.OccurrenceDate.String(), e.OffsetDays, e.ChannelID, e.Status, e.Error)
	if err != nil { return false, err }
	n, err := r.RowsAffected()
	return n > 0, err
}
```

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/store/ -v`

```bash
git add internal/store/ && git commit -m "feat(store): channels, settings json, notification log dengan dedupe"
```

---

### Task 6: calendarprov — holiday provider (computed)

**Files:**
- Create: `internal/calendarprov/calendarprov.go`
- Test: `internal/calendarprov/calendarprov_test.go`

**Interfaces:**
- Consumes: `domain.PawukonHolidaysBetween`
- Produces:
```go
type Provider interface {
	Name() string
	Category() string // "pawukon" | "saka" | "national"
	HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error)
}
func NewComputedPawukon() Provider
type MultiProvider struct{ Providers []Provider }
func (m MultiProvider) HolidaysBetween(ctx context.Context, from, to domain.Date, enabled map[string]bool) ([]domain.Holiday, error) // filter per category
```
(This interface is FINAL — Plan 3 adds remote implementations rather than changing the interface.)

- [ ] **Step 1: Test (failing)**

`internal/calendarprov/calendarprov_test.go`:

```go
package calendarprov

import (
	"context"
	"testing"

	"otorem/internal/domain"
)

func TestComputedPawukon(t *testing.T) {
	p := NewComputedPawukon()
	if p.Category() != "pawukon" { t.Errorf("category = %q", p.Category()) }
	hs, err := p.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 7, 31))
	if err != nil { t.Fatal(err) }
	found := map[string]bool{}
	for _, h := range hs { found[h.Name] = true }
	if !found["Galungan"] || !found["Kuningan"] { t.Errorf("galungan/kuningan missing: %v", hs) }
}

func TestMultiProviderFilter(t *testing.T) {
	m := MultiProvider{Providers: []Provider{NewComputedPawukon()}}
	hs, err := m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30), map[string]bool{"pawukon": false})
	if err != nil { t.Fatal(err) }
	if len(hs) != 0 { t.Errorf("category off must be empty: %v", hs) }
	hs, _ = m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30), map[string]bool{"pawukon": true})
	if len(hs) != 2 { t.Errorf("category on: %v", hs) }
}
```

- [ ] **Step 2: Run — FAIL**, then implement

`internal/calendarprov/calendarprov.go`:

```go
// Package calendarprov: holiday sources. Computed holidays are derived locally
// from the Pawukon engine; remote providers (Plan 3) add API sources with caching.
package calendarprov

import (
	"context"

	"otorem/internal/domain"
)

type Provider interface {
	Name() string
	Category() string
	HolidaysBetween(ctx context.Context, from, to domain.Date) ([]domain.Holiday, error)
}

type computedPawukon struct{}

func NewComputedPawukon() Provider { return computedPawukon{} }
func (computedPawukon) Name() string     { return "pawukon-computed" }
func (computedPawukon) Category() string { return "pawukon" }
func (computedPawukon) HolidaysBetween(_ context.Context, from, to domain.Date) ([]domain.Holiday, error) {
	return domain.PawukonHolidaysBetween(from, to), nil
}

// MultiProvider combines providers and filters by the settings categories.
type MultiProvider struct{ Providers []Provider }

func (m MultiProvider) HolidaysBetween(ctx context.Context, from, to domain.Date, enabled map[string]bool) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for _, p := range m.Providers {
		if !enabled[p.Category()] { continue }
		hs, err := p.HolidaysBetween(ctx, from, to)
		if err != nil { return nil, err }
		out = append(out, hs...)
	}
	return out, nil
}
```

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/calendarprov/ -v`

```bash
git add internal/calendarprov/ && git commit -m "feat(calendarprov): provider interface + computed pawukon"
```

---

### Task 7: Auth middleware — Cloudflare Access + dev mode

**Files:**
- Create: `internal/api/auth.go`
- Test: `internal/api/auth_test.go`

**Interfaces:**
- Consumes: `config.Config`, `store.Store.GetOrCreateUser`, `secret` is not used here
- Produces:
```go
type UserProvisioner interface { GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (store.User, error) }
func NewCFAccessFromKeyfunc(kf jwt.Keyfunc, aud string, provision UserProvisioner, adminEmails map[string]bool) gin.HandlerFunc
func NewCFAccess(ctx context.Context, cfg config.Config, provision UserProvisioner) (gin.HandlerFunc, error)
// JWKS: https://{team}/cdn-cgi/access/certs, header: Cf-Access-Jwt-Assertion, RS256, aud & exp required
// dev mode: X-Dev-Email header → provision; empty → 401
```

- [ ] **Step 1: Test with a local JWKS (failing)**

`internal/api/auth_test.go`:

```go
package api

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"otorem/internal/store"
)

type stubProvisioner struct{ users map[string]store.User }

func (s *stubProvisioner) GetOrCreateUser(_ context.Context, email, name string, admins map[string]bool) (store.User, error) {
	u, ok := s.users[email]
	if ok { return u, nil }
	role := "member"
	if admins[email] { role = "admin" }
	u = store.User{ID: int64(len(s.users) + 1), Email: email, Name: name, Role: role}
	s.users[email] = u
	return u, nil
}

func makeJWKS(t *testing.T, key *rsa.PrivateKey) (jwt.Keyfunc, *httptest.Server) {
	t.Helper()
	pub := key.PublicKey
	jwks := map[string]any{"keys": []map[string]any{{
		"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test-key",
		"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	}}}
	b, _ := json.Marshal(jwks)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(b) }))
	t.Cleanup(srv.Close)
	kf, err := keyfunc.NewRemote(context.Background(), keyfunc.NewRemoteConfig{URL: srv.URL, Client: srv.Client()})
	if err != nil { t.Fatal(err) }
	return kf, srv
}

func signToken(t *testing.T, key *rsa.PrivateKey, aud, email string, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"aud": []string{aud}, "email": email, "name": email, "exp": exp.Unix(),
	})
	s, err := tok.SignedString(key)
	if err != nil { t.Fatal(err) }
	return s
}

func TestCFAccessMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	kf, _ := makeJWKS(t, key)
	prov := &stubProvisioner{users: map[string]store.User{}}
	mw := NewCFAccessFromKeyfunc(kf, "aud-1", prov, map[string]bool{"admin@x.id": true})

	r := gin.New()
	r.GET("/who", mw, func(c *gin.Context) {
		u := c.MustGet("user").(store.User)
		c.JSON(200, gin.H{"email": u.Email, "role": u.Role})
	})

	// no header → 401
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/who", nil))
	if w.Code != 401 { t.Errorf("without jwt: %d", w.Code) }

	// valid token → provision admin
	tok := signToken(t, key, "aud-1", "admin@x.id", time.Now().Add(time.Hour))
	req := httptest.NewRequest("GET", "/who", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", tok)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"admin"`) {
		t.Errorf("valid jwt: %d %s", w.Code, w.Body.String())
	}

	// wrong aud → 401
	tokBad := signToken(t, key, "aud-2", "admin@x.id", time.Now().Add(time.Hour))
	req = httptest.NewRequest("GET", "/who", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", tokBad)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 401 { t.Errorf("wrong aud: %d", w.Code) }

	// expired → 401
	tokExp := signToken(t, key, "aud-1", "admin@x.id", time.Now().Add(-time.Hour))
	req = httptest.NewRequest("GET", "/who", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", tokExp)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 401 { t.Errorf("expired: %d", w.Code) }
}

func TestDevAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	prov := &stubProvisioner{users: map[string]store.User{}}
	mw := devAuthMiddleware(prov, map[string]bool{})
	r := gin.New()
	r.GET("/who", mw, func(c *gin.Context) {
		u := c.MustGet("user").(store.User)
		c.JSON(200, gin.H{"email": u.Email})
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/who", nil))
	if w.Code != 401 { t.Errorf("without header: %d", w.Code) }
	req := httptest.NewRequest("GET", "/who", nil)
	req.Header.Set("X-Dev-Email", "dev@x.id")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 { t.Errorf("with header: %d %s", w.Code, w.Body.String()) }
}
```
(tested via `strings.Contains` — no dedicated helper needed.)

- [ ] **Step 2: Run — FAIL**, then implement `internal/api/auth.go`

```go
package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"otorem/internal/config"
	"otorem/internal/store"
)

type UserProvisioner interface {
	GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (store.User, error)
}

// NewCFAccessFromKeyfunc: verify Cf-Access-Jwt-Assertion → provision the user.
// The keyfunc is injected so it can be tested with a local JWKS.
func NewCFAccessFromKeyfunc(kf jwt.Keyfunc, aud string, provision UserProvisioner, adminEmails map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.GetHeader("Cf-Access-Jwt-Assertion"))
		if raw == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token Cloudflare Access tidak ada"})
			return
		}
		parsed, err := jwt.Parse(raw, kf,
			jwt.WithValidMethods([]string{"RS256"}),
			jwt.WithAudience(aud),
			jwt.WithExpirationRequired(),
		)
		if err != nil || !parsed.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("token tidak valid: %v", err)})
			return
		}
		claims, ok := parsed.Claims.(jwt.MapClaims)
		if !ok { c.AbortWithStatusJSON(401, gin.H{"error": "klaim tidak terbaca"}); return }
		email, _ := claims["email"].(string)
		name, _ := claims["name"].(string)
		if email == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "klaim email kosong — pastikan Access policy menyertakan email"})
			return
		}
		u, err := provision.GetOrCreateUser(c.Request.Context(), email, name, adminEmails)
		if err != nil {
			c.AbortWithStatusJSON(500, gin.H{"error": "provision user gagal"})
			return
		}
		c.Set("user", u)
		c.Next()
	}
}

// NewCFAccess: production JWKS keyfunc from the Access team domain.
func NewCFAccess(ctx context.Context, cfg config.Config, provision UserProvisioner) (gin.HandlerFunc, error) {
	jwksURL := fmt.Sprintf("https://%s/cdn-cgi/access/certs", cfg.CFTeamDomain)
	kf, err := keyfunc.NewRemote(ctx, keyfunc.NewRemoteConfig{
		URL:             jwksURL,
		Client:          &http.Client{Timeout: 10 * time.Second},
		RefreshInterval: time.Hour,
	})
	if err != nil { return nil, err }
	return NewCFAccessFromKeyfunc(kf, cfg.CFAud, provision, cfg.AdminEmails), nil
}

// devAuthMiddleware: ONLY for AUTH_MODE=dev.
func devAuthMiddleware(provision UserProvisioner, adminEmails map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		email := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Dev-Email")))
		if email == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "mode dev: header X-Dev-Email wajib"})
			return
		}
		u, err := provision.GetOrCreateUser(c.Request.Context(), email, email, adminEmails)
		if err != nil {
			c.AbortWithStatusJSON(500, gin.H{"error": "provision user gagal"})
			return
		}
		c.Set("user", u)
		c.Next()
	}
}
```

Note: `Store` satisfies `UserProvisioner` structurally — no adapter needed.

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/api/ -v`

```bash
git add internal/api/ && git commit -m "feat(api): cloudflare access jwt middleware + dev auth"
```

---

### Task 8: Gin server, handlers, upcoming endpoint

**Files:**
- Create: `internal/api/server.go`
- Create: `internal/api/handlers.go`
- Create: `internal/api/upcoming.go`
- Create: `internal/api/settings.go`
- Test: `internal/api/server_test.go`

**Interfaces:**
- Consumes: everything above + `calendarprov.MultiProvider`, `secret.DeriveKey`
- Produces:
```go
type RunResult struct{ Sent, Failed, Missed int }          // filled in by Plan 3
type SchedulerRunner interface { RunOnce(ctx context.Context) (RunResult, error) }
type Server struct{ /* cfg, st, key, providers, runner */ }
func NewServer(cfg config.Config, st *store.Store, providers []calendarprov.Provider) *Server
func (s *Server) SetRunner(r SchedulerRunner)              // called by Plan 3
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) // for httptest

// Settings type (settings.go), used by handlers + Plan 3:
type Settings struct {
	Timezone          string          `json:"timezone"`           // "Asia/Jakarta"
	SendTime          string          `json:"send_time"`          // "08:00"
	CatchUpHours      int             `json:"catch_up_hours"`     // 24
	DefaultOffsets    []int           `json:"default_offsets"`    // [7,4,2,1,0]
	HolidayCategories map[string]bool `json:"holiday_categories"` // pawukon/saka/national
}
func DefaultSettings() Settings
func (s *Server) LoadSettings(ctx context.Context) Settings // merge defaults ← DB
func (s *Server) SaveSettings(ctx context.Context, in Settings) (Settings, error) // validation
```

- [ ] **Step 1: Implement server.go (core structure — handlers follow)**

`internal/api/server.go`:

```go
package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"otorem/internal/calendarprov"
	"otorem/internal/config"
	"otorem/internal/secret"
	"otorem/internal/store"
)

type RunResult struct{ Sent, Failed, Missed int }

type SchedulerRunner interface{ RunOnce(ctx context.Context) (RunResult, error) }

type Server struct {
	cfg       config.Config
	st        *store.Store
	key       []byte
	providers []calendarprov.Provider
	runner    SchedulerRunner
	engine    *gin.Engine
}

func NewServer(cfg config.Config, st *store.Store, providers []calendarprov.Provider) *Server {
	s := &Server{cfg: cfg, st: st, key: secret.DeriveKey(cfg.AppSecret), providers: providers}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), slogMiddleware())

	r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := st.Ping(ctx); err != nil {
			c.JSON(503, gin.H{"error": "db tidak siap"}); return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	apiG := r.Group("/api/v1")
	if cfg.AuthMode == config.AuthDev {
		apiG.Use(devAuthMiddleware(st, cfg.AdminEmails))
	} else {
		mw, err := NewCFAccess(context.Background(), cfg, st)
		if err != nil { slog.Error("cfaccess init gagal", "err", err); panic(err) }
		apiG.Use(mw)
	}

	apiG.GET("/me", s.handleMe)
	apiG.GET("/contacts", s.handleListContacts)
	apiG.POST("/contacts", s.handleCreateContact)
	apiG.GET("/contacts/:id", s.handleGetContact)
	apiG.PATCH("/contacts/:id", s.handleUpdateContact)
	apiG.DELETE("/contacts/:id", s.handleDeleteContact)
	apiG.POST("/contacts/:id/occasions", s.handleAddOccasion)
	apiG.DELETE("/occasions/:id", s.handleDeleteOccasion)
	apiG.PUT("/contacts/:id/prefs", s.handleSetPrefs)
	apiG.GET("/upcoming", s.handleUpcoming)
	apiG.GET("/pawukon", s.handlePawukon)
	apiG.GET("/channels", s.handleListChannels)
	apiG.POST("/channels", s.handleCreateChannel)
	apiG.PATCH("/channels/:id", s.handlePatchChannel)
	apiG.DELETE("/channels/:id", s.handleDeleteChannel)
	apiG.GET("/settings", s.handleGetSettings)
	apiG.PUT("/settings", s.handlePutSettings)
	apiG.GET("/users", s.handleListUsers) // admin
	apiG.POST("/scheduler/run", s.handleSchedulerRun) // admin; runner from Plan 3

	s.engine = r
	return s
}

// SetRunner is called by main after the scheduler is built (Plan 3).
func (s *Server) SetRunner(r SchedulerRunner) { s.runner = r }

func (s *Server) ServeHTTP(w http.ResponseWriter, req *http.Request) { s.engine.ServeHTTP(w, req) }

func slogMiddleware() gin.HandlerFunc {
	log := slog.Default()
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info("http", "method", c.Request.Method, "path", c.Request.URL.Path,
			"status", c.Writer.Status(), "dur", time.Since(start).Round(time.Millisecond).String())
	}
}

func mustUser(c *gin.Context) store.User { return c.MustGet("user").(store.User) }
```

`internal/api/settings.go`:

```go
package api

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"otorem/internal/domain"
)

type Settings struct {
	Timezone          string          `json:"timezone"`
	SendTime          string          `json:"send_time"`
	CatchUpHours      int             `json:"catch_up_hours"`
	DefaultOffsets    []int           `json:"default_offsets"`
	HolidayCategories map[string]bool `json:"holiday_categories"`
}

func DefaultSettings() Settings {
	return Settings{
		Timezone:       "Asia/Jakarta",
		SendTime:       "08:00",
		CatchUpHours:   24,
		DefaultOffsets: domain.DefaultOffsets,
		HolidayCategories: map[string]bool{
			"pawukon": true, "saka": true, "national": true,
		},
	}
}

var sendTimeRe = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// LoadSettings: defaults ← JSON override from the DB (key "settings").
func (s *Server) LoadSettings(ctx context.Context) Settings {
	out := DefaultSettings()
	var stored Settings
	if err := s.st.GetSettingJSON(ctx, "settings", &stored); err != nil {
		return out // ErrNotFound or an old encoding → defaults
	}
	if stored.Timezone != "" { out.Timezone = stored.Timezone }
	if stored.SendTime != "" { out.SendTime = stored.SendTime }
	if stored.CatchUpHours > 0 { out.CatchUpHours = stored.CatchUpHours }
	if len(stored.DefaultOffsets) > 0 { out.DefaultOffsets = stored.DefaultOffsets }
	if stored.HolidayCategories != nil { out.HolidayCategories = stored.HolidayCategories }
	return out
}

func (s *Server) SaveSettings(ctx context.Context, in Settings) (Settings, error) {
	if _, err := time.LoadLocation(in.Timezone); err != nil {
		return Settings{}, fmt.Errorf("timezone tidak dikenal: %q", in.Timezone)
	}
	if !sendTimeRe.MatchString(in.SendTime) {
		return Settings{}, fmt.Errorf("send_time harus HH:MM, dapat %q", in.SendTime)
	}
	if in.CatchUpHours < 1 || in.CatchUpHours > 168 {
		return Settings{}, fmt.Errorf("catch_up_hours harus 1..168")
	}
	if err := domain.ValidateOffsets(in.DefaultOffsets); err != nil { return Settings{}, err }
	for _, cat := range []string{"pawukon", "saka", "national"} {
		if _, ok := in.HolidayCategories[cat]; !ok { in.HolidayCategories[cat] = false }
	}
	if err := s.st.PutSettingJSON(ctx, "settings", in); err != nil { return Settings{}, err }
	return in, nil
}
```

`internal/api/upcoming.go`:

```go
package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"otorem/internal/domain"
)

type UpcomingItem struct {
	Date        domain.Date `json:"date"`
	Kind        string      `json:"kind"` // "occasion" | "holiday"
	OccasionID  int64       `json:"occasion_id,omitempty"`
	ContactID   int64       `json:"contact_id,omitempty"`
	ContactName string      `json:"contact_name,omitempty"`
	Type        string      `json:"type,omitempty"`
	Number      int         `json:"number,omitempty"`
	Title       string      `json:"title"`
	Pawukon     string      `json:"pawukon,omitempty"`
	DaysUntil   int         `json:"days_until"`
	Reminders   []int       `json:"reminders,omitempty"`
}

func (s *Server) handleUpcoming(c *gin.Context) {
	user := mustUser(c)
	ctx := c.Request.Context()
	settings := s.LoadSettings(ctx)

	days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
	if err != nil || days < 1 || days > 90 { days = 30 }
	loc, locErr := time.LoadLocation(settings.Timezone)
	if locErr != nil { loc = time.UTC }
	now := time.Now().In(loc)
	today := domain.DateFromTime(now)
	horizon := today.AddDays(days)

	ownerID := user.ID
	if user.Role == "admin" { ownerID = 0 }
	contacts, err := s.st.ListContacts(ctx, ownerID)
	if err != nil { c.JSON(500, gin.H{"error": "gagal memuat kontak"}); return }

	var items []UpcomingItem
	for _, cw := range contacts {
		offsets := settings.DefaultOffsets
		if cw.Prefs != nil && cw.Prefs.Enabled && len(cw.Prefs.Offsets) > 0 {
			offsets = cw.Prefs.Offsets
		}
		for _, occ := range cw.Occasions {
			occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, today, horizon)
			if err != nil { continue }
			for _, o := range occs {
				item := UpcomingItem{
					Date: o.Date, Kind: "occasion", OccasionID: occ.ID, ContactID: cw.ID,
					ContactName: cw.Name, Type: string(o.Type), Number: o.Number,
					Title: o.Label, DaysUntil: o.Date.JDN() - today.JDN(), Reminders: offsets,
				}
				if occ.Type == domain.Otonan { item.Pawukon = domain.Pawukon(o.Date).Label() }
				items = append(items, item)
			}
		}
	}

	hs, err := s.multiProvider().HolidaysBetween(ctx, today, horizon, settings.HolidayCategories)
	if err != nil { c.JSON(502, gin.H{"error": "provider hari raya gagal"}); return }
	for _, h := range hs {
		items = append(items, UpcomingItem{Date: h.Date, Kind: "holiday",
			Title: h.Name, DaysUntil: h.Date.JDN() - today.JDN()})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Date != items[j].Date { return items[i].Date.Before(items[j].Date) }
		return items[i].Kind < items[j].Kind
	})
	c.JSON(http.StatusOK, gin.H{"today": today.String(), "items": items})
}

func (s *Server) multiProvider() calendarprov.MultiProvider {
	return calendarprov.MultiProvider{Providers: s.providers}
}
```

`internal/api/handlers.go` — CRUD + pawukon + scheduler run (compact; the pattern is the same throughout):

```go
package api

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"otorem/internal/domain"
	"otorem/internal/secret"
	"otorem/internal/store"
)

func bind[T any](c *gin.Context) (*T, bool) {
	var v T
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return nil, false
	}
	return &v, true
}

func respondErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		c.JSON(404, gin.H{"error": "tidak ditemukan"})
	default:
		c.JSON(500, gin.H{"error": err.Error()})
	}
}

func pathID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(400, gin.H{"error": "id tidak valid"})
		return 0, false
	}
	return id, true
}

func (s *Server) handleMe(c *gin.Context) {
	u := mustUser(c)
	c.JSON(200, gin.H{"email": u.Email, "name": u.Name, "role": u.Role})
}

type contactIn struct {
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Notes    string `json:"notes"`
}

func (s *Server) scope(c *gin.Context) int64 {
	u := mustUser(c)
	if u.Role == "admin" { return 0 }
	return u.ID
}

func (s *Server) handleListContacts(c *gin.Context) {
	list, err := s.st.ListContacts(c.Request.Context(), s.scope(c))
	if err != nil { respondErr(c, err); return }
	c.JSON(200, gin.H{"contacts": list})
}

func (s *Server) handleCreateContact(c *gin.Context) {
	in, ok := bind[contactIn](c)
	if !ok { return }
	if in.Name == "" { c.JSON(400, gin.H{"error": "nama wajib"}); return }
	ct, err := s.st.CreateContact(c.Request.Context(), mustUser(c).ID, in.Name, in.Nickname, in.Notes)
	if err != nil { respondErr(c, err); return }
	c.JSON(201, ct)
}

func (s *Server) handleGetContact(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	cw, err := s.st.GetContact(c.Request.Context(), s.scope(c), id)
	if err != nil { respondErr(c, err); return }
	c.JSON(200, cw)
}

func (s *Server) handleUpdateContact(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	in, ok := bind[contactIn](c)
	if !ok { return }
	if err := s.st.UpdateContact(c.Request.Context(), s.scope(c), id, in.Name, in.Nickname, in.Notes); err != nil {
		respondErr(c, err); return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) handleDeleteContact(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	if err := s.st.DeleteContact(c.Request.Context(), s.scope(c), id); err != nil { respondErr(c, err); return }
	c.JSON(200, gin.H{"ok": true})
}

type occasionIn struct {
	Type   string `json:"type"`
	Date   string `json:"date"` // YYYY-MM-DD
	Label  string `json:"label"`
}

func (s *Server) handleAddOccasion(c *gin.Context) {
	cid, ok := pathID(c)
	if !ok { return }
	in, ok := bind[occasionIn](c)
	if !ok { return }
	if _, err := s.st.GetContact(c.Request.Context(), s.scope(c), cid); err != nil {
		respondErr(c, err); return
	}
	base, err := domain.ParseDate(in.Date)
	if err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	oc, err := s.st.AddOccasion(c.Request.Context(), cid, domain.OccurrenceType(in.Type), base, in.Label)
	if err != nil { respondErr(c, err); return }
	c.JSON(201, oc)
}

func (s *Server) handleDeleteOccasion(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	if err := s.st.DeleteOccasion(c.Request.Context(), id); err != nil { respondErr(c, err); return }
	c.JSON(200, gin.H{"ok": true})
}

type prefsIn struct {
	Offsets    *[]int  `json:"offsets"`
	ChannelIDs *[]int64 `json:"channel_ids"`
	Enabled    *bool   `json:"enabled"`
}

func (s *Server) handleSetPrefs(c *gin.Context) {
	cid, ok := pathID(c)
	if !ok { return }
	in, ok := bind[prefsIn](c)
	if !ok { return }
	cw, err := s.st.GetContact(c.Request.Context(), s.scope(c), cid)
	if err != nil { respondErr(c, err); return }
	p := store.ReminderPrefs{ContactID: cid, Offsets: s.LoadSettings(c.Request.Context()).DefaultOffsets,
		ChannelIDs: []int64{}, Enabled: true}
	if cw.Prefs != nil { p = *cw.Prefs; p.ContactID = cid }
	if in.Offsets != nil { p.Offsets = *in.Offsets }
	if in.ChannelIDs != nil { p.ChannelIDs = *in.ChannelIDs }
	if in.Enabled != nil { p.Enabled = *in.Enabled }
	if err := domain.ValidateOffsets(p.Offsets); err != nil {
		c.JSON(400, gin.H{"error": err.Error()}); return
	}
	if err := s.st.SetReminderPrefs(c.Request.Context(), p); err != nil { respondErr(c, err); return }
	c.JSON(200, p)
}

func (s *Server) handlePawukon(c *gin.Context) {
	d, err := domain.ParseDate(c.Query("date"))
	if err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	p := domain.Pawukon(d)
	c.JSON(200, gin.H{"date": d.String(), "saptawara": domain.Saptawara[p.Saptawara],
		"pancawara": domain.Pancawara[p.Pancawara], "wuku": domain.Wuku[p.Wuku], "label": p.Label()})
}

// ---- channels: config is stored encrypted; it is never sent back ----

type channelIn struct {
	Type   string          `json:"type"`
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

func (s *Server) handleListChannels(c *gin.Context) {
	list, err := s.st.ListChannels(c.Request.Context(), s.scope(c))
	if err != nil { respondErr(c, err); return }
	out := make([]gin.H, 0, len(list))
	for _, ch := range list {
		out = append(out, gin.H{"id": ch.ID, "type": ch.Type, "name": ch.Name, "enabled": ch.Enabled})
	}
	c.JSON(200, gin.H{"channels": out})
}

func (s *Server) handleCreateChannel(c *gin.Context) {
	in, ok := bind[channelIn](c)
	if !ok { return }
	enc, err := s.encryptConfig(in.Type, in.Config)
	if err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	ch, err := s.st.CreateChannel(c.Request.Context(), mustUser(c).ID, in.Type, in.Name, enc)
	if err != nil { respondErr(c, err); return }
	c.JSON(201, gin.H{"id": ch.ID, "type": ch.Type, "name": ch.Name, "enabled": ch.Enabled})
}

func (s *Server) handlePatchChannel(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	in, ok := bind[struct{ Enabled *bool `json:"enabled"` }](c)
	if !ok { return }
	if in.Enabled == nil { c.JSON(400, gin.H{"error": "enabled wajib"}); return }
	if err := s.st.SetChannelEnabled(c.Request.Context(), s.scope(c), id, *in.Enabled); err != nil {
		respondErr(c, err); return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) handleDeleteChannel(c *gin.Context) {
	id, ok := pathID(c)
	if !ok { return }
	if err := s.st.DeleteChannel(c.Request.Context(), s.scope(c), id); err != nil { respondErr(c, err); return }
	c.JSON(200, gin.H{"ok": true})
}

// validateChannelConfig ensures the JSON config has the minimum fields per type
// before it is encrypted. (The notifier implementation lives in Plan 3.)
func (s *Server) validateChannelConfig(typ string, raw json.RawMessage) error {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil { return errors.New("config harus JSON object") }
	need := map[string][]string{
		"gotify":   {"base_url", "token"},
		"telegram": {"bot_token", "chat_id"},
		"email":    {"host", "port", "from", "to"},
	}[typ]
	if need == nil { return errors.New("tipe channel tidak dikenal") }
	for _, k := range need {
		if v, ok := m[k]; !ok || v == nil || v == "" {
			return errors.New("field config '" + k + "' wajib untuk tipe " + typ)
		}
	}
	return nil
}

func (s *Server) encryptConfig(typ string, raw json.RawMessage) ([]byte, error) {
	if err := s.validateChannelConfig(typ, raw); err != nil { return nil, err }
	return secret.Encrypt(s.key, raw)
}

// ---- settings ----

func (s *Server) handleGetSettings(c *gin.Context) {
	c.JSON(200, s.LoadSettings(c.Request.Context()))
}

func (s *Server) handlePutSettings(c *gin.Context) {
	in, ok := bind[Settings](c)
	if !ok { return }
	out, err := s.SaveSettings(c.Request.Context(), *in)
	if err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	c.JSON(200, out)
}

// ---- admin ----

func (s *Server) handleListUsers(c *gin.Context) {
	if mustUser(c).Role != "admin" { c.JSON(403, gin.H{"error": "khusus admin"}); return }
	users, err := s.st.ListUsers(c.Request.Context())
	if err != nil { respondErr(c, err); return }
	c.JSON(200, gin.H{"users": users})
}

func (s *Server) handleSchedulerRun(c *gin.Context) {
	if mustUser(c).Role != "admin" { c.JSON(403, gin.H{"error": "khusus admin"}); return }
	if s.runner == nil { c.JSON(503, gin.H{"error": "scheduler belum aktif"}); return }
	res, err := s.runner.RunOnce(c.Request.Context())
	if err != nil { respondErr(c, err); return }
	c.JSON(200, gin.H{"sent": res.Sent, "failed": res.Failed, "missed": res.Missed})
}
```

- [ ] **Step 2: Write the integration test** — for strict TDD: write this test file first, run it to see it red (compile error `NewServer undefined`), then turn it green with the Step 1 implementation

`internal/api/server_test.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"otorem/internal/config"
	"otorem/internal/domain"
	"otorem/internal/store"
)

func newTestServer(t *testing.T, admin string) (*Server, *store.Store) {
	t.Helper()
	ginSet(t)
	st, err := store.OpenInMemory()
	if err != nil { t.Fatal(err) }
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil { t.Fatal(err) }
	cfg := config.Config{AppSecret: "super-secret-panjang-16", AuthMode: config.AuthDev,
		AdminEmails: map[string]bool{admin: true}, TZ: "Asia/Jakarta"}
	return NewServer(cfg, st, nil), st
}

func ginSet(t *testing.T) { gin.SetMode(gin.TestMode) } // via the gin import

func devReq(t *testing.T, method, target, email, body string) *http.Request {
	t.Helper()
	var rd io.Reader
	if body != "" { rd = strings.NewReader(body) }
	req := httptest.NewRequest(method, target, rd)
	if body != "" { req.Header.Set("Content-Type", "application/json") }
	req.Header.Set("X-Dev-Email", email)
	return req
}

func TestContactFlow(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts", "admin@x.id",
		`{"name":"Made","nickname":"De","notes":"sepupu"}`))
	if w.Code != 201 { t.Fatalf("create contact: %d %s", w.Code, w.Body.String()) }

	// Otonan base = today − 210 → occurrence #1 falls EXACTLY today; deterministic
	// for a 30-day window (random dates often fall outside the window → flaky).
	today := domain.DateFromTime(time.Now())
	base := today.AddDays(-domain.PawukonCycleDays)
	ocBody, _ := json.Marshal(map[string]string{"type": "otonan", "date": base.String()})
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts/1/occasions", "admin@x.id", string(ocBody)))
	if w.Code != 201 { t.Fatalf("add occasion: %d %s", w.Code, w.Body.String()) }

	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming?days=30", "admin@x.id", ""))
	if w.Code != 200 { t.Fatalf("upcoming: %d %s", w.Code, w.Body.String()) }
	if !strings.Contains(w.Body.String(), `"kind":"occasion"`) || !strings.Contains(w.Body.String(), `"pawukon"`) {
		t.Errorf("upcoming does not contain occasion+pawukon: %s", w.Body.String())
	}
}

func TestUpcomingEmpty(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming", "admin@x.id", ""))
	if w.Code != 200 { t.Fatal(w.Code) }
	var out struct {
		Items []UpcomingItem `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil { t.Fatal(err) }
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
		`{"type":"gotify","name":"rumah","config":{"base_url":"https://g.x.id","token":"TOKET-RAHASIA"}}`))
	if w.Code != 201 { t.Fatalf("create channel: %d %s", w.Code, w.Body.String()) }
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/channels", "admin@x.id", ""))
	if strings.Contains(w.Body.String(), "TOKET-RAHASIA") {
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
		`{"timezone":"Tidak/Ada","send_time":"07:30","catch_up_hours":12,"default_offsets":[1],"holiday_categories":{}}`))
	if w.Code != 400 { t.Errorf("an invalid tz must be 400: %d", w.Code) }
}

func TestSchedulerRunWithoutRunner(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "admin@x.id", ""))
	if w.Code != 503 { t.Errorf("without a runner: %d", w.Code) }
	_ = context.Background()
}
```

Fix the details in the test above: `ginSet` needs the `"github.com/gin-gonic/gin"` import; `devReq` needs the `"io"` import. Include both.

- [ ] **Step 3: Run — PASS, then commit**

Run: `go test ./internal/api/ -v`
Expected: PASS. (Note: `TestUpcomingEmpty` with `providers=nil` → `MultiProvider{nil}` loops over an empty slice; the handler's nil `s.providers` is still safe — an empty `MultiProvider.Providers` returns `nil, nil`.)

```bash
git add internal/api/ && git commit -m "feat(api): gin server, crud handlers, upcoming timeline, settings"
```

---

### Task 9: main.go wiring + local smoke test

**Files:**
- Create: `cmd/server/main.go`

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Implement main.go**

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"otorem/internal/api"
	"otorem/internal/calendarprov"
	"otorem/internal/config"
	"otorem/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config tidak valid", "err", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		slog.Error("gagal buat data dir", "dir", cfg.DataDir, "err", err)
		os.Exit(1)
	}
	st, err := store.Open(cfg.DBPath())
	if err != nil {
		slog.Error("gagal buka db", "path", cfg.DBPath(), "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		slog.Error("migrasi gagal", "err", err)
		os.Exit(1)
	}

	providers := []calendarprov.Provider{calendarprov.NewComputedPawukon()}
	srv := api.NewServer(cfg, st, providers)

	httpServer := &http.Server{Addr: cfg.Addr, Handler: srv, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		slog.Info("otorem jalan", "addr", cfg.Addr, "auth", cfg.AuthMode)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	slog.Info("shutdown...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
```

- [ ] **Step 2: Build + local smoke test**

```bash
CGO_ENABLED=0 go build -o /tmp/otorem ./cmd/server
APP_SECRET=dev-secret-panjang-16 AUTH_MODE=dev DATA_DIR=/tmp/otoremdata /tmp/otorem &
sleep 1
curl -s localhost:8080/healthz
curl -s -H 'X-Dev-Email: admin@x.id' localhost:8080/api/v1/me
curl -s localhost:8080/api/v1/me          # → 401
pkill -f /tmp/otorem || true
```
Expected: `{"ok":true}`, then the admin user data, then 401 without the header.

- [ ] **Step 3: Commit + tag**

```bash
gofmt -l internal/ cmd/ ; go vet ./... && CGO_ENABLED=0 go test ./... -count=1
git add cmd/ && git commit -m "feat(server): main wiring config+store+api dengan graceful shutdown"
git tag plan-2-store-api-auth-done
```

---

## Definition of Done (Plan 2)

- [ ] `CGO_ENABLED=0 go test ./... -count=1` fully green.
- [ ] The local smoke test works: healthz OK, `/me` requires auth, dev auth provisions users.
- [ ] Channel config is encrypted in the DB and never appears in responses.
- [ ] Tag `plan-2-store-api-auth-done`.

**Contract for Plan 3:** `api.SchedulerRunner` + `api.RunResult{Sent,Failed,Missed}`; `store.RecordNotification` (dedupe); `store.ListChannels`/`GetChannel` (encrypted ConfigEnc); `calendarprov.Provider` (Name/Category/HolidaysBetween); `secret.DeriveKey(cfg.AppSecret)`; `api.Settings` (Timezone, SendTime "HH:MM", CatchUpHours, DefaultOffsets, HolidayCategories).
