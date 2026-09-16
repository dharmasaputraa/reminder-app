# Deployment ke Dokploy — Panduan Setup

Alur versioning: **git tag → GitHub Actions build image → push ke GHCR → Dokploy pull & jalankan**.
Server tidak pernah build — semua build terjadi di GitHub Actions.

```
git tag v1.2.3 && git push origin v1.2.3
        │
        ▼
GitHub Actions (release.yml)
  go test → buildx multi-arch (amd64+arm64)
        │
        ▼
ghcr.io/dharmasaputraa/reminder-app
  tag: 1.2.3 · 1.2 · 1 · latest · sha-xxxxxxx
        │  (API call: POST /api/application.deploy)
        ▼
Dokploy (pull :latest → container baru → healthz → routing)
```

Image yang sudah terbit bisa dilihat di: `github.com/dharmasaputraa/reminder-app/pkgs/container/reminder-app`.

---

## Tahap 1 — GitHub: buat PAT untuk GHCR

Dokploy butuh token untuk **menarik** image dari GHCR.

1. Buka <https://github.com/settings/tokens> → **Generate new token (classic)**.
2. Beri note, mis. `dokploy-ghcr-read`.
3. Centang scope **`read:packages`** (cukup untuk pull; pakai `write:packages` hanya jika ingin Dokploy bisa push juga).
4. Generate, **copy token** (hanya tampil sekali).

## Tahap 2 — Dokploy: daftarkan Registry GHCR

1. Panel Dokploy → menu **Registry** → pilih **GHCR**.
2. Isi:
   - **Registry Name**: `ghcr` (bebas)
   - **Username**: `dharmasaputraa`
   - **Password/Token**: token PAT dari Tahap 1
   - **Registry URL**: `ghcr.io`
3. Klik **Test** (harus sukses) → **Create**.

## Tahap 3 — Dokploy: buat Application

1. Project → **Create Service** → **Application**.
2. Tab **General** → Source Type: **Docker**.
3. **Docker Image**: `ghcr.io/dharmasaputraa/reminder-app:latest`
4. Pilih registry `ghcr` yang didaftarkan di Tahap 2 (atau isi registry URL + credential manual).
5. **Save** — jangan Deploy dulu; lengkapi dulu Environment & Volume (Tahap 4–5).

> Setelah rilis pertama, package GHCR masih **private** (default). Selama registry di Tahap 2 benar, pull tetap jalan. Ingin pull tanpa credential? Ubah visibility package jadi public lewat halaman Packages di GitHub.

## Tahap 4 — Environment variables (tab Environment)

| Variabel | Wajib | Nilai / contoh |
| --- | --- | --- |
| `APP_SECRET` | ✅ | acak min. 16 char — `openssl rand -base64 32`. Kunci enkripsi channel notifikasi; **jangan pernah diubah** setelah ada data |
| `AUTH_MODE` | ✅ | `cfaccess` |
| `CF_ACCESS_TEAM_DOMAIN` | ✅ | `team-anda.cloudflareaccess.com` (lihat Tahap 7) |
| `CF_ACCESS_AUD` | ✅ | AUD tag aplikasi Access (lihat Tahap 7) |
| `ADMIN_EMAILS` | ✅ | email admin, pisah koma |
| `TZ` | opsional | `Asia/Makassar` (timezone log; jadwal reminder dikonfigurasi dari UI Settings) |

Yang **tidak perlu** diisi (sudah di-default oleh image / hanya untuk dev):
`DATA_DIR` (default `/data`), `ADDR` (default `:8080`), `APP_PORT` & `TUNNEL_TOKEN` (khusus docker-compose manual di VPS), `DEV_SEED_*` (khusus `AUTH_MODE=dev`).

## Tahap 5 — Volume (tab Volumes) — WAJIB

SQLite disimpan di `/data`. **Tanpa volume, seluruh data hilang setiap redeploy/restart.**

- Mount: `/data` → named volume (mis. `wimember-data`) atau host path (mis. `/var/lib/wimember`).

## Tahap 6 — Domain (tab Domains)

1. Add domain → arahkan ke **port 8080** (port internal app).
2. DNS: A/CNAME domain → VPS, dan **proxy Cloudflare ON** (oranye).
3. HTTPS: biarkan Dokploy (Traefik + Let's Encrypt) yang handle, atau set Full (strict) jika terminate di Cloudflare.

## Tahap 7 — Cloudflare Access (autentikasi app)

App memvalidasi JWT Cloudflare Access (`AUTH_MODE=cfaccess`), jadi domain harus dilindungi Access:

1. Cloudflare Zero Trust → **Access → Applications → Add → Self-hosted**.
2. Application domain: domain app dari Tahap 6.
3. Policy: **Allow** → Include → Emails → isi sama dengan `ADMIN_EMAILS`.
4. Dari halaman aplikasi Access, copy **Team domain** (`xxx.cloudflareaccess.com`) dan **AUD tag** → isi ke env `CF_ACCESS_TEAM_DOMAIN` & `CF_ACCESS_AUD` di Tahap 4.

Detail tambahan: README §Cloudflare Access setup.

## Tahap 8 — Health check

Image sudah membawa `HEALTHCHECK` bawaan (GET `/healthz`, port 8080, tiap 30s). Jika tab **Advanced** di aplikasi Dokploy menyediakan opsi health check/restart, set path `/healthz` port `8080` — kalau tidak ada, bawaan image sudah cukup.

## Tahap 9 — Sambungkan CI/CD (sekali saja)

1. **API key Dokploy**: avatar/profile → **API Keys** → buat baru → copy (hanya tampil sekali).
2. **Application ID**: buka application di panel — ID-nya ada di URL, `.../service/<applicationId>`.
3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions → New repository secret):

   | Secret | Isi |
   | --- | --- |
   | `DOKPLOY_URL` | `https://panel-dokploy-anda.com` (tanpa trailing slash) |
   | `DOKPLOY_API_KEY` | API key dari langkah 1 |
   | `DOKPLOY_APPLICATION_ID` | ID dari langkah 2 |

   Tanpa secrets ini workflow release **tetap** build & push image — hanya langkah auto-redeploy yang dilewati.

## Tahap 10 — Rilis pertama & verifikasi

```bash
git tag v0.1.0 && git push origin v0.1.0
```

1. Pantau tab **Actions** di GitHub (workflow *Release*, ± 3–6 menit untuk multi-arch).
2. Image muncul di halaman **Packages** repo.
3. Dokploy otomatis redeploy — cek tab **Deployments** di aplikasi.
4. Verifikasi:
   ```bash
   curl https://domain-anda.com/healthz     # {"ok":true}
   ```
   Lalu buka domain → login lewat Cloudflare Access → app tampil.

---

## Operasional sehari-hari

**Rilis versi baru**: `git tag v1.2.4 && git push origin v1.2.4` — selesai.

### Build image di lokal (opsional)

Jalur utama build adalah GitHub Actions — server **tidak pernah build** (hanya pull).
Untuk eksperimen/hotfix cepat, image bisa dibangun di mesin lokal (Podman, tanpa Docker):

```bash
make test                                        # build lokal tidak lewat gerbang CI — test manual dulu
podman build --platform linux/amd64 \
  -t ghcr.io/dharmasaputraa/reminder-app:0.1.0 . # sesuaikan arch server (uname -m)
podman run --rm -d --name smoke -p 8081:8080 \
  -e APP_SECRET=dev-secret-long-16 -e AUTH_MODE=dev -e ADMIN_EMAILS=a@b.c \
  ghcr.io/dharmasaputraa/reminder-app:0.1.0
curl -s localhost:8081/healthz && podman rm -f smoke   # smoke test (README §Container verification)
echo "<TOKEN>" | podman login ghcr.io -u dharmasaputraa --password-stdin
podman push ghcr.io/dharmasaputraa/reminder-app:0.1.0
```

- PAT untuk push harus **`write:packages`** (read-only tidak cukup).
- Setelah push: ganti tag di Dokploy → Deploy, atau trigger `POST /api/application.deploy` seperti CI.
- Catatan: build lokal melewati test CI dan cross-arch di Mac jalan via emulasi (lebih lambat) — pakai hanya untuk hotfix; rilis resmi tetap lewat `git tag`.

**Rollback**: tab **General** di aplikasi Dokploy → ganti tag image ke versi lama (mis. `ghcr.io/dharmasaputraa/reminder-app:1.2.2`) → **Deploy**. Semua versi tersimpan di GHCR.

**Redeploy versi yang sama**: tombol **Deploy** di panel, atau ulangi workflow Release via *Run workflow* (manual dispatch).

## Backup (disarankan)

Satu-satunya state adalah `SQLite di /data` (`wimember.db`). Konfigurasi Litestream sudah tersedia di `deploy/litestream.yml` — replicate ke S3/R2:

1. Buat bucket + access key (S3 atau Cloudflare R2; untuk R2 isi `LITESTREAM_ENDPOINT`).
2. Isi replica URL di `deploy/litestream.yml`, commit.
3. Jalankan litestream sebagai service terpisah di Dokploy (image `litestream/litestream`), share volume `/data` yang sama, env `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY` / `LITESTREAM_ENDPOINT`.
4. Restore: `litestream restore -o /data/wimember.db s3://bucket/wimember/wimember.db`.

## Troubleshooting

| Gejala | Sebab umum |
| --- | --- |
| Deploy gagal pull `manifest unknown` | Tag belum ada di GHCR — build Actions belum selesai / tag salah ketik |
| Deploy gagal pull `denied` | Package private + credential registry salah / PAT tanpa `read:packages` |
| API deploy 401/403 | `DOKPLOY_API_KEY` atau `DOKPLOY_APPLICATION_ID` salah |
| API deploy tidak sampai (timeout) | Cloudflare di depan panel memblok POST — matikan Bot Fight Mode / buat rule allow untuk path `/api/*` |
| App error `APP_SECRET required` | Env belum diisi di tab Environment |
| Data kontak hilang setelah redeploy | Volume `/data` tidak terpasang (Tahap 5) |
| Redirect loop / 403 dari Access | `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` tidak cocok dengan aplikasi Access |
