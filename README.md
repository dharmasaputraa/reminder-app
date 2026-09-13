# otorem

**otorem** adalah pengingat swadaya (self-hosted) untuk otonan Bali berbasis Pawukon 210 hari, ulang tahun, anniversary, dan hari raya — dihitung otomatis lalu dikirim lewat Gotify, Telegram, atau email. Semuanya berjalan dari satu container: SPA sudah tertanam di dalam binary Go, database SQLite tersimpan di volume, dan akses diamankan Cloudflare Access tanpa password tambahan.

## Fitur

- **Otonan & pawukon** — siklus otonan 210 hari dihitung dari tanggal lahir; label memuat saptawara, pancawara, dan wuku.
- **Jenis acara lain** — ulang tahun (termasuk 29 Feb), anniversary, dan hari raya Pawukon baku (Galungan, Kuningan, Saraswati, Pagerwesi).
- **Hari raya nasional & Saka** — kategori bisa di-toggle; data remote di-cache di SQLite.
- **Offset customizable** — default H-7, H-4, H-2, H-1, H+0; tiap kontak bisa punya offset sendiri.
- **Dedupe anti dobel** — unique constraint di log notifikasi menjamin satu reminder terkirim sekali per acara/tanggal/offset/channel.
- **Catch-up** — reminder yang terlewat selama container mati tetap dikirim (default window 24 jam) dengan label "terlambat".
- **Multi-channel** — Gotify (self-hosted), Telegram, dan SMTP/email; config channel terenkripsi AES-256-GCM dengan `APP_SECRET`.
- **Tes kirim** — tombol tes per channel dari halaman Channels.
- **PWA** — manifest + service worker, installable dari HP.
- **Observability** — `/healthz`, `/readyz`, dan `/metrics` (Prometheus).
- **Jam kirim & timezone** — default 08:00 dan `Asia/Jakarta`, diubah dari UI Settings (mis. `Asia/Makassar` untuk WITA).

## Quickstart

Butuh Docker (+ Compose) **atau** Podman (+ podman-compose), dan sebuah domain yang diarahkan ke Cloudflare (untuk tunnel).

```bash
git clone <repo-anda> otorem && cd otorem
cp .env.example .env   # edit APP_SECRET, CF_ACCESS_*, ADMIN_EMAILS
podman-compose up -d                 # app saja; tanpa profile bila cloudflared sudah jalan di host
# (pengguna Docker: docker compose up -d --build; butuh tunnel in-container: tambahkan --profile cloudflared)
```

Aplikasi hanya listen di network internal compose; akses publik lewat tunnel Cloudflare. Buka `https://otorem.domain-anda.com`.

Profil compose (semua opsional, `app` selalu ikut):

| Profile | Isi | Perintah |
|---|---|---|
| `cloudflared` | tunnel in-container (butuh `TUNNEL_TOKEN`) — **skip bila cloudflared sudah jalan di host** | `docker compose --profile cloudflared up -d` |
| `gotify` | Gotify self-hosted (`http://gotify:80`) | `docker compose --profile gotify up -d` |
| `litestream` | replikasi SQLite ke S3/R2 | `docker compose --profile litestream up -d` |

Profil bisa digabung, mis. `docker compose --profile cloudflared --profile gotify --profile litestream up -d`.

**Cloudflared di host (skema umum):** app mem-publish port `APP_PORT` (default `8080`) ke host — arahkan tunnel cloudflared Anda ke `http://localhost:8080` (sesuaikan `APP_PORT` di `.env` bila port dipakai). Auth tetap dari **Cloudflare Access** di sisi Cloudflare (team domain + policy email), bukan dari container.

### Environment

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `APP_SECRET` | ya | — | Kunci AES-256-GCM config channel, minimal 16 karakter |
| `AUTH_MODE` | ya | `cfaccess` | `cfaccess` (produksi) atau `dev` (tanpa tunnel) |
| `CF_ACCESS_TEAM_DOMAIN` | mode cfaccess | — | `team-anda.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | mode cfaccess | — | Application Audience tag dari Access |
| `ADMIN_EMAILS` | disarankan | — | Email admin, pisah koma; admin bisa lihat semua kontak & jalan scheduler manual |
| `TZ` | tidak | `Asia/Jakarta` | Timezone proses container (log). **Timezone jadwal & jam kirim reminder diatur di UI Settings** (default `Asia/Jakarta`, ubah ke `Asia/Makassar` untuk WITA) |
| `DATA_DIR` | tidak | `/data` (image) | Lokasi file SQLite |
| `ADDR` | tidak | `:8080` | Alamat listen |
| `TUNNEL_TOKEN` | profile cloudflared | — | Token tunnel Cloudflare |

## Cloudflare Access setup

1. Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Domain: `otorem.domain-anda.com` (subdomain yang dipakai tunnel).
3. Tambah policy: Action **Allow**, Include **Emails** → email Anda (dan anggota keluarga).
4. Catat dua nilai dari aplikasi Access:
   - **Team domain**: `team-anda.cloudflareaccess.com` → `CF_ACCESS_TEAM_DOMAIN`
   - **Application Audience (AUD) tag** → `CF_ACCESS_AUD`
5. Buat tunnel: Zero Trust → **Networks** → **Tunnels** → **Create a tunnel** (Cloudflared) → salin **TUNNEL_TOKEN** ke `.env`.
6. Tambah **Public hostname** di tunnel: `otorem.domain-anda.com` → Service `http://app:8080`.
7. Isi `.env` (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`) lalu `docker compose --profile cloudflared up -d`.

Aplikasi memvalidasi JWT Cloudflare Access (JWKS di-cache); email dari klaim JWT dipakai untuk auto-provision user, dan email di `ADMIN_EMAILS` mendapat role admin.

## Dev mode (tanpa tunnel)

Untuk mencoba lokal tanpa Cloudflare Access:

```bash
AUTH_MODE=dev make run
```

Buka `http://localhost:8080`; saat diminta, masukkan email bebas (mis. `admin@local.test`). Secara teknis mode dev membaca header `X-Dev-Email` — berguna untuk curl:

```bash
curl -H 'X-Dev-Email: admin@local.test' http://localhost:8080/api/v1/upcoming
```

Jangan pakai `AUTH_MODE=dev` di instance yang terekspos publik.

## Notifikasi

Channel dikelola dari halaman **Channels** di UI (config tersimpan terenkripsi). Tiap channel bisa dites dengan tombol **Tes kirim**.

- **Gotify** — buat application di UI Gotify → salin **token**. Isi Base URL (`http://gotify:80` jika memakai profile `gotify`, atau URL Gotify Anda) dan token. Priority opsional (default 5).
- **Telegram** — chat dengan [@BotFather](https://t.me/BotFather) → `/newbot` → salin bot token. Kirim satu pesan ke bot, lalu ambil `chat_id` dari `https://api.telegram.org/bot<TOKEN>/getUpdates` (atau lewat @userinfobot). Isi bot token + chat_id.
- **Email (SMTP)** — disarankan Gmail app-password (`smtp.gmail.com:587`, user = alamat Gmail, password = app password 16 karakter) atau SMTP relay transaksional. Isi host, port, username, password, from, dan daftar penerima. Catatan: mengirim email langsung dari IP rumah (port 25) hampir selalu masuk spam/diblokir — selalu pakai relay.

## Backup & restore

Data utama hanya satu file: `./data/otorem.db` (SQLite mode WAL). Selama container berjalan, salin volume `./data` secara konsisten, atau pakai Litestream untuk replikasi berkelanjutan.

**Litestream (opsional, disarankan):**

1. Isi `deploy/litestream.yml` (path DB + URL bucket S3/R2).
2. Isi kredensial di `.env`: `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, dan `LITESTREAM_ENDPOINT` (untuk R2; S3 boleh dikosongkan). Container `litestream` membaca `.env` lewat `env_file`.
3. Jalankan `docker compose --profile litestream up -d`.

**Restore:**

```bash
docker compose stop app
docker compose --profile litestream run --rm litestream \
  restore -o /data/otorem.db s3://bucket-anda/otorem/otorem.db
docker compose start app
```

Untuk restore satu kali tanpa mengisi `.env`, berikan kredensial langsung ke `docker compose run`, mis. `docker compose --profile litestream run --rm -e LITESTREAM_ACCESS_KEY_ID=… -e LITESTREAM_SECRET_ACCESS_KEY=… litestream restore -o /data/otorem.db s3://bucket-anda/otorem/otorem.db`.

Alternatif tanpa Litestream: stop app, salin kembali `otorem.db`, start app.

## Pengembangan

```bash
make test    # CGO_ENABLED=0 go test ./... -count=1
make web     # npm ci + build SPA → internal/api/webroot (embed)
make build   # build SPA + binary ke bin/otorem
make run     # build + jalankan dev mode di :8080
make container  # docker compose build, fallback podman-compose (Makefile)
```

Fixture pawukon di-`scrape` sekali saat dev (bukan runtime) dengan modul terpisah:

```bash
cd scripts/fetch_fixtures && go run . -year 2026 -out ../../testdata
```

Data fixture © [kalenderbali.org](https://kalenderbali.org) (I Wayan Nuarsa, Universitas Udayana) — dipakai sebagai fixture pengujian pribadi dan dikreditkan; **jangan dire distribusikan**. Runtime otorem tidak pernah bergantung pada situs pihak ketiga.

**Catatan provider hari raya remote:** provider `dayoffapi` dan `kresnasatya` memakai cache-first dengan negative-cache 10 menit — bila layanan remote sedang mati, otorem berhenti mencoba sementara dan memakai cache yang ada. Perhitungan Pawukon/otonan lokal tetap berjalan penuh; hanya hari raya nasional yang sementara kosong.

## Verifikasi Container

**Sudah diverifikasi dengan Podman 6.0.2 + podman-compose 1.6.0** di mesin pengembang: `podman build -t otorem:latest .` sukses (image 39,7 MB), smoke container lulus (healthz, SPA, deep-link, scheduler-run). Catatan Podman: HEALTHCHECK diabaikan pada format OCI — tambahkan `--format docker` pada `podman build` bila healthcheck diinginkan. Langkah berikut tetap relevan untuk pengguna Docker:

Lingkungan pengembangan saat ini belum ada Docker, sehingga langkah berikut harus dijalankan manual di mesin yang punya Docker:

```bash
cp .env.example .env   # isi APP_SECRET minimal
docker compose config                        # validasi compose, tanpa error
docker compose build app                     # image terbangun
docker run --rm -d --name otorem-smoke -p 8081:8080 \
  -e APP_SECRET=dev-secret-panjang-16 -e AUTH_MODE=dev -e ADMIN_EMAILS=a@b.c otorem-app:latest
sleep 2
curl -s localhost:8081/healthz               # harapan: {"ok":true}
curl -s localhost:8081/ | head -c 120        # harapan: HTML SPA (<!doctype html> / <div id="root">)
curl -s -o /dev/null -w '%{http_code}\n' localhost:8081/contacts/1   # harapan: 200 (deep-link SPA)
curl -s -H 'X-Dev-Email: a@b.c' -X POST localhost:8081/api/v1/scheduler/run   # harapan: {"sent":...,"failed":...,"missed":...}
docker rm -f otorem-smoke
```

Catatan: `ADMIN_EMAILS` wajib ikut karena `/scheduler/run` hanya untuk admin. Nama image hasil `docker compose build app` mengikuti nama direktori project (mis. `otorem-app` bila repo ada di folder `otorem`); bila berbeda, sesuaikan tag atau bangun dengan `docker build -t otorem-app .`.

Verifikasi tanpa Docker tetap bisa dilakukan lewat `make test` + `make build` + `make run` (lihat §Pengembangan).

## Struktur proyek

```
code/
├── cmd/server/main.go          # wiring: config, db, router, scheduler, notifiers
├── internal/
│   ├── domain/                 # PURE: pawukon, occurrence, holidays pawukon, offset
│   ├── store/                  # SQLite: migrasi embedded, repository per tabel
│   ├── notify/                 # Notifier + gotify.go, telegram.go, smtp.go
│   ├── scheduler/              # ticker, Clock, dedupe, catch-up
│   ├── api/                    # Gin handlers, middleware cfaccess, embed static
│   └── calendarprov/           # HolidayProvider + impl computed/remote
├── scripts/fetch_fixtures/     # scraper kalenderbali.org → testdata/*.csv (modul terpisah)
├── web/                        # SPA Vite + React; hasil build → internal/api/webroot (embed)
├── deploy/                     # litestream.yml, contoh config deploy
├── testdata/                   # fixture CSV pawukon (kalenderbali.org, jangan dire distribusikan)
├── Dockerfile                  # multi-stage: node build → go build → alpine (diverifikasi podman)
├── docker-compose.yml          # app + profile cloudflared/gotify/litestream
└── docs/superpowers/specs/     # dokumen desain
```
