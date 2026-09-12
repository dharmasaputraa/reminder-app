# Design Doc: `otorem` — Pengingat Otonan Bali, Ulang Tahun, & Hari Raya

Tanggal: 2026-09-12 · Status: menunggu review user · Bahasa dokumen: Indonesia

## 1. Ringkasan

App self-hosted untuk mengingatkan **otongan Bali** (ulang tahun Pawukon, berulang tiap 210 hari),
**ulang tahun** (tahunan), dan **anniversary** (tahunan), plus **hari raya** (Pawukon dihitung lokal;
Nyepi/Saka & libur nasional via API dengan cache). Notifikasi ke **Gotify, Telegram, dan Email (SMTP)**
dengan offset customizable (default H-7, H-4, H-2, H-1, H). Dikemas dalam **satu container Docker**,
di-host di device lokal, di-expose via **cloudflared tunnel**, auth memakai **Cloudflare Access**.

Nama kerja: **otorem** (OTOnan REMinder).

## 2. Keputusan Stack (final)

| Komponen | Pilihan | Alasan |
|---|---|---|
| Bahasa backend | **Go** | Keputusan user; velocity cepat, single binary, RAM kecil untuk home device |
| HTTP framework | **Gin** | User familiar; berbasis `net/http` → kompatibel `go:embed` & middleware standar (Fiber/fasthttp tidak dipilih: deviasi stdlib, kecepatan raw tidak relevan di traffic 1–2 user) |
| Database | **SQLite** via `modernc.org/sqlite` (pure-Go, CGO off) | Satu node, nol service tambahan, WAL mode, gampang dibackup; CGO off → cross-compile & image kecil |
| Auth | **Cloudflare Access + validasi JWT** | Keputusan user ("supaya tidak terlalu over"); app tanpa password/session rumit |
| Frontend | **Vite + React + TypeScript + TanStack Router + TanStack Query + Tailwind** | DX modern type-safe tanpa Next.js/TanStack Start (nol Node runtime di produksi); build statis di-embed `go:embed` |
| Scheduling | In-process ticker (Goroutine) | Portable di container; tidak bergantung cron host |
| Deploy | Docker multi-stage + `docker-compose.yml` | Sesuai permintaan; profile opsional `cloudflared`/`gotify`/`litestream` |
| Timezone | Default `Asia/Jakarta`, configurable per instance | Pengguna Bali umumnya WITA — jadi **wajib configurable**, default tetap WIB |

## 3. Arsitektur

Modular monolith, satu binary. Logika tanggal dipisah total dari I/O agar bisa dites eksklusif.

```
code/
├── cmd/server/main.go          # wiring: config, db, router, scheduler, notifiers
├── internal/
│   ├── domain/                 # PURE: pawukon, occurrence, holidays pawukon, offset
│   ├── store/                  # SQLite: migrasi embedded, repository per tabel
│   ├── notify/                 # interface Notifier + gotify.go, telegram.go, smtp.go
│   ├── scheduler/              # ticker, Clock interface, dedupe, catch-up
│   ├── api/                    # Gin handlers, middleware cfaccess, embed static
│   └── calendarprov/           # HolidayProvider interface + impl computed/remote
├── scripts/fetch_fixtures.go   # scraper kalenderbali.org → testdata/*.csv
├── web/                        # SPA (Vite); hasil build → internal/api/webroot (embed)
├── deploy/                     # Dockerfile, docker-compose.yml, contoh config
├── migrations/                 # SQL migrasi (embedded via store)
├── testdata/                   # fixture CSV pawukon (dari kalenderbali.org)
└── docs/superpowers/specs/     # dokumen ini
```

Alur data reminder: `ticker (tiap menit) → scheduler hitung due reminders (domain, pure) →
bandingkan notification_log (dedupe) → kirim via Notifier (retry) → catat status`.

## 4. Model Data (SQLite)

```sql
users            (id, email UNIQUE, name, role CHECK(admin|member), created_at)
                 -- auto-provision dari klaim email Cloudflare Access; ADMIN_EMAILS env → admin
contacts         (id, owner_id→users, name, nickname, notes, created_at)
occasions        (id, contact_id→contacts, type CHECK(birthday|otongan|anniversary),
                  base_date DATE, label TEXT, created_at)
                 -- birthday/otongan: base_date = tanggal lahir; anniversary: tanggal bebas
reminder_prefs   (id, contact_id UNIQUE→contacts, offsets JSON, channel_ids JSON,
                  enabled BOOL DEFAULT 1)   -- override per kontak; NULL = pakai default global
channels         (id, owner_id→users, type CHECK(gotify|telegram|email), name,
                  config_enc BLOB, enabled, created_at)
                 -- config JSON terenkripsi AES-256-GCM dengan APP_SECRET (env)
notification_log (id, occasion_id NULLABLE, holiday_key TEXT NULLABLE,
                  occurrence_date DATE, offset_days INT, channel_id→channels,
                  status CHECK(sent|failed|missed), error TEXT, sent_at)
                 -- UNIQUE(occasion_id, occurrence_date, offset_days, channel_id)
                 -- UNIQUE(holiday_key, occurrence_date, offset_days, channel_id)
                 -- unique constraint = dedupe anti kirim dobel
settings         (key PK, value JSON)  -- timezone, send_time, catch_up_hours,
                                       -- default_offsets, registrasi info, kategori hari raya aktif
holiday_cache    (year INT, source TEXT, payload JSON, fetched_at, UNIQUE(year, source))
```

## 5. Engine Domain (pure, tanpa I/O)

### 5.1 Pawukon: gregorian → (saptawara, pancawara, wuku)

Siklus Pawukon **210 hari tanpa kabisat/penyesuaian** — murni aritmetika modulo.

```
cycleDay(D) = ((JDN(D) − JDN(ANCHOR) + 73) mod 210) + 1
saptawara[cycleDay] = hariMingguan(D)           # Redite=Sunday … Saniscara=Saturday (cek konsistensi gratis)
pancawara[cycleDay] = PAWUKON5[(cycleDay−1) mod 5]   # [Paing, Pon, Wage, Kliwon, Umanis], hari-1 = Paing
wuku[cycleDay]      = WUKU30[ceil(cycleDay/7)]       # 30 nama: Sinta, Landep, …, Watugunung
```

- **Anchor awal**: 2026-06-17 adalah Galungan = **Buda Kliwon Wuku Dunggulan** = hari ke-74 siklus
  (Dunggulan = hari 71–77; hari-74 = Buda & Kliwon). Anchor ini **dikunci oleh test**, bukan dipercaya:
  unit test memverifikasi ≥3 Galungan terpublikasi (23 Apr 2025, 19 Nov 2025, 17 Jun 2026), Kuningan
  (Saniscara Kliwon Wuku Kuningan, Galungan+10), plus fixture harian dari kalenderbali.org.
  Salah anchor → test merah → anchor diperbaiki di satu konstanta.
- JDN dihitung dengan algoritma standar (proleptic Gregorian), timezone-div-free (tanggal saja).
- Konsistensi internal: `saptawara` hasil mod-7 harus sama dengan hari mingguan Gregorian.
- Sistem 10 minggu Pawukon (urip, dasawara, dst.) **tidak diimplementasi v1** — label otonan hanya butuh
  saptawara+pancawara+wuku. Struktur domain disiapkan agar bisa ditambah nanti.

### 5.2 Occurrence & reminder

- **otongan**: `otonganKeN(tglLahir, N) = tglLahir + 210·N`. Berikutnya = N terkecil dengan
  tanggal ≥ hari ini. Label: `"{Saptawara} {Pancawara}, Wuku {Wuku}"` + `"Otonan ke-N"`.
  Konsistensi: pawukon(tglLahir) harus == pawukon(tanggal otonan) (assert di test).
- **birthday**: tahunan; **29 Feb → 1 Mar di tahun non-kabisat** (konvensi dateutil, didokumentasikan
  di UI). Umur dihitung aktual.
- **anniversary**: tahunan tanggal bebas, tanpa umur.
- **Offset reminder**: default global `[7, 4, 2, 1, 0]` (hari sebelum H; 0 = hari H), jam kirim
  configurable (default 08:00), **override per kontak** (offset + channel_ids).
- Due reminder pada tanggal `T` = `{occasion, occurrence_date = T + offset}` dikirim pada
  `send_time` tanggal itu (di timezone instance). Semua perhitungan timezone-aware via `time.Location`.

### 5.3 Hari raya

- **Dihitung lokal (Pawukon)**: tabel `{nama, saptawara, pancawara, wuku}` — Galungan
  (Buda/Kliwon/Dunggulan), Kuningan (Saniscara/Kliwon/Kuningan), Saraswati, Pagerwesi, Sugihan Jawa/Bali,
  Banyu Pinaruh, Soma Ribek, Sabuh, Penyepahan, deret Tumpek. Definisi yang sudah baku (Galungan,
  Kuningan, Saraswati, Pagerwesi) masuk v1; **sisa tabel diverifikasi terhadap fixture sebelum diaktifkan**
  (definisi ragam di sumber populer — fixture adalah wasit).
- **Via API (HolidayProvider interface)**: `ComputedPawukonProvider` (tabel di atas),
  `RemoteProvider` → `kresnasatya/api-harilibur` (hari raya Bali/Saka) + `dayoffapi.vercel.app`
  (libur nasional incl. Nyepi). Refresh harian ke `holiday_cache`; **API gagal → pakai cache/statis**,
  scheduler tetap jalan. Toggle per kategori di Settings. Bisa dinonaktifkan seluruhnya tanpa
  menyentuh core.

## 6. Sumber Data & Etika Scraping

| Sumber | Peran | Catatan |
|---|---|---|
| Wikipedia "Pawukon calendar" | Struktur: 30 wuku, urip, siklus | Statis, domain pengetahuan |
| kalenderbali.org (`rerainan.php?bulan=X&tahun=Y`, `alaayu.php?...`) | **Fixture test** (1–2 tahun data harian) | Data © I Wayan Nuarsa/Unud — dipakai sebagai fixture pribadi & dikreditkan, **tidak dire distribusikan**; scraping sekali saat dev, bukan runtime |
| Galungan/Kuningan terpublikasi (23 Apr 2025, 19 Nov 2025, 17 Jun 2026) | Verifikasi anchor | ≥3 sumber independen |
| `asnash9306/balinese-calendar-rust`, `ericwidhiantara/balinese_calendar_project` | Referensi algoritma | Lisensi dicek sebelum melihat kode; kalau tidak jelas, implementasi dari definisi (algoritmanya trivial) |
| kresnasatya/api-harilibur, dayoffapi.vercel.app | Runtime opsional (hari raya) | Cache + fallback; app offline-safe |

**Prinsip: runtime tidak pernah bergantung pada website pihak ketiga.** Scraping hanya untuk fixture
dan verifikasi. Tidak ada request outbound dari scheduler ke situs kalender.

## 7. Scheduler & Keandalan Pengiriman

- Ticker per menit → kumpulkan due reminders → kirim → catat. **Stateless scan**, bukan queue
  materialisasi: idempotent, tahan crash/restart, recovery otomatis.
- **Dedupe**: unique constraint di `notification_log`; retry gagal aman dari kirim dobel.
- **Catch-up window** (default 24 jam, configurable): device mati saat jadwal kirim → begitu hidup,
  reminder yang terlambat ≤ window dikirim berlabel "terlambat N jam"; lebih dari itu ditandai
  `missed` (masih tercatat di log, tanpa spam kumpulan).
- **Retry per channel**: 3× exponential backoff (mis. 5s/25s/125s) — Gotify lokal bisa sedang restart.
- **Clock interface** (`Now() time.Time`) di-inject → fake clock untuk test deterministik
  (simulasi device mati 30 jam, dsb.).
- Pengiriman paralel per channel (worker pool kecil), timeout per HTTP call.

## 8. Notifier

```go
type Notifier interface {
    Name() string
    Send(ctx context.Context, msg Message) error  // judul, isi, meta kontak, priority
    Test(ctx context.Context) error               // tombol "kirim tes" di UI
}
```

- **Gotify**: `POST {url}/message?token=…` (title, message, priority).
- **Telegram**: Bot API `sendMessage` (chat_id, text, parse_mode=HTML).
- **Email**: SMTP (host/port/user/pass/from), template HTML + text alternative.
- Template pesan per tipe occasion, contoh:
  `🎂 {nama} ultah ke-{umur} 3 hari lagi (Senin, 15 Sep)` ·
  `🛕 Otonan ke-12 — Anggara Kliwon, Wuku Sinta — 2 hari lagi`.
- Config channel (token/password) **terenkripsi AES-256-GCM** dengan `APP_SECRET` sebelum masuk DB
  (DB akan dibackup; token jangan plaintext).

## 9. Auth: Cloudflare Access

- Access policy melindungi hostname tunnel; browser dapat cookie `CF_Authorization`.
- Setiap request lewat tunnel membawa header `Cf-Access-Jwt-Assertion` (RS256).
- Middleware Gin: verifikasi signature via JWKS `https://{team}.cloudflareaccess.com/cdn-cgi/access/certs`,
  cek `aud` (AUD tag app Access) & `exp`; klaim `email`/`name` → auto-provision `users`.
- Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS` (email di daftar → role admin).
- Stateless per request — **tanpa tabel sessions/password**. Akses LAN langsung tanpa JWT → 401.
- `AUTH_MODE=dev` (harus eksplisit): identitas dummy `X-Dev-Email` untuk development tanpa tunnel;
  middleware menolak kombinasi dev+public tanpa flag.
- Rate limit/brute force bukan tanggung jawab app (layer Cloudflare).

## 10. API (REST, `/api/v1`)

| Endpoint | Fungsi |
|---|---|
| `GET /me` | Identitas dari JWT |
| `GET/POST /contacts`, `PATCH/DELETE /contacts/{id}` | CRUD kontak (+ occasions nested) |
| `GET /upcoming?days=30` | Timeline gabungan occasions + hari raya aktif |
| `GET/POST/PATCH/DELETE /channels`, `POST /channels/{id}/test` | Kelola channel notifikasi + tes |
| `GET/PUT /settings` | Offset default, jam kirim, tz, catch-up, kategori hari raya |
| `GET /users` (admin), `POST /scheduler/run` (admin) | Kelola user; trigger scan manual |
| `GET /healthz`, `/readyz` (cek DB), `/metrics` (Prometheus) | Observability |

Gin: middleware recovery + request logging (slog JSON) + cfaccess; statis SPA via `NoRoute` + embed.

## 11. Frontend (SPA)

- **Dashboard**: timeline "30 hari ke depan" — kartu per event (ultah/otongan/hari raya) dengan
  countdown, badge pawukon, offset yang akan dikirim. Peringatan "belum ada channel" jika kosong.
- **Contacts**: CRUD + editor occasions (pilih tipe, tanggal) + **preview pawukon instan**
  (hitung di client via WASM? Tidak — v1 cukup endpoint `GET /pawukon?date=…`; WASM ditunda).
- **Channels**: tambah/edit/test gotify-telegram-email.
- **Settings**: offset default, jam kirim, timezone, catch-up, toggle kategori hari raya, daftar user (admin).
- PWA manifest + ikon → installable dari HP. Same-origin dengan API (dilayani binary Go).

## 12. Deployment

- **Dockerfile multi-stage**: (1) node build `web/` → (2) `go build` CGO off → (3) image final
  alpine/distroless ~20MB. Healthcheck `wget /healthz`.
- **docker-compose.yml**:
  - `app`: volume `/data` (SQLite), env `APP_SECRET`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`,
    `ADMIN_EMAILS`, `TZ`.
  - `cloudflared` (profile): `TUNNEL_TOKEN`, `depends_on: app`, network internal.
  - `gotify` (profile): kalau belum punya Gotify sendiri.
  - `litestream` (profile): replikasi SQLite → R2/S3 (backup keluarga wajib awet).
- **README**: langkah setup Access (buat app Access → catat team domain + AUD), SMTP relay
  (Gmail app password / transaksional — kirim email dari IP rumah rawan spam), backup volume,
  cara restore.

## 13. Testing

1. **Unit (table-driven)**: pawukon vs fixture CSV (scrape kalenderbali.org), anchor Galungan×3 + Kuningan,
   otonan deret 210 hari, birthday 29 Feb, pergantian tahun offset (H-7 dari 1 Jan), DST-free tz.
2. **Property**: pawukon(t) == pawukon(t+210) untuk ratusan tanggal acak.
3. **Integrasi**: httptest + SQLite in-memory: auth middleware (JWT valid/kadaluarsa/aud salah/dev),
   CRUD, upcoming, dedupe (kirim 2× → 1 log).
4. **Scheduler**: fake clock — due tepat waktu, catch-up 30 jam (→ `missed`), 5 jam (→ kirim "terlambat").
5. **Notifier**: httptest mock Gotify/Telegram; SMTP via mock server; retry & backoff.
6. **Smoke**: `docker compose up` → healthz, buat kontak, trigger scheduler run, notifikasi mock masuk.

## 14. Di Luar Scope v1 (YAGNI)

Upload foto kontak, sharing keluarga multi-owner, konversi Pawukon lengkap 10 wewaran di client (WASM),
i18n ganda, native mobile app, ekspor iCal (mudah ditambah belakangan), multi-instance DB.

## 15. Milestone Implementasi

| # | Milestone | Isi |
|---|---|---|
| 0 | Scaffold + spec | Folder `code/`, git, struktur modul, design doc (dokumen ini), review user → writing-plans |
| 1 | Engine domain (TDD) | `domain/`: pawukon + fixture test, otonan/birthday/anniversary, offset, hari raya Pawukon baku, property test |
| 2 | Store & API | Migrasi + repository, CRUD, middleware cfaccess(+dev), upcoming, healthz/readyz |
| 3 | Scheduler & Notifier | Ticker + Clock, dedupe, catch-up, retry, 3 notifier, enkripsi config, test send |
| 4 | HolidayProvider remote | kresnasatya + dayoffapi, cache, toggle kategori (boleh dilewati tanpa sentuh core) |
| 5 | SPA | Dashboard, Contacts, Channels, Settings, PWA, embed |
| 6 | Deploy & verifikasi | Dockerfile, compose + profiles, README, `go test ./...` hijau, smoke test, review visual |

## 16. Asumsi Terbuka (mohon konfirmasi saat review)

1. Tipe `otongan` v1 = **siklus 210 hari dari tanggal lahir** dengan label saptawara+pancawara+wuku.
2. Anchor Pawukon dikunci via tanggal Galungan terpublikasi + fixture kalenderbali.org (5.1).
3. Bahasa UI: campuran Indonesia natural (label hari raya & pawukon tetap istilah Bali).
4. Multi-user ringan: semua user melihat semua kontak? **Default: per-user (owner), admin melihat semua.**
