# Refactor UI otorem ke reUI (fallback shadcn) — Design

Tanggal: 2026-09-13
Status: menunggu review pengguna
Aturan utama (keinginan pengguna): **pakai komponen dari reUI; jika tidak ada, ambil dari shadcn.**

## Keputusan default (dipilih sendiri karena Q&A tak terjawab; bisa diubah saat review)

1. Halaman pilot: **Settings** (paling sederhana, 100% hand-rolled).
2. Dikerjakan di **branch baru** `feature/reui-refactor` dari HEAD `feature/otorem-v1`.
3. **Upgrade penuh** pola interaksi: `confirm()` native → AlertDialog, checkbox
   "aktif" → Switch, status inline `<p>` → toast (sonner).

## Hasil audit (ringkas)

- Fondasi: shadcn **base-nova** (Base UI) dengan token tema lengkap; 14 primitif di
  `src/components/ui/`; event calendar Dashboard sudah reUI (`c-event-calendar-3`,
  primitif `@reui/event-calendar/*`) — **tidak disentuh**.
- Masalah: primitif `ui/` hampir tak dipakai route. Dashboard hanya `button`+`tooltip`;
  Settings/Channels/Contacts (list & detail) 100% elemen native + Tailwind ad-hoc:
  native select/input/checkbox, `confirm()` browser, status inline `<p>`, kartu dan
  badge dari class manual.
- Gap `ui/` (belum ada): `alert`, `alert-dialog`, `badge`, `checkbox`, `sonner`,
  `skeleton` — semua tersedia via reUI free.
- Katalog reUI terverifikasi: 1.105 contoh `c-*` dalam 74 kategori, semua dapat
  di-install tanpa license (probe HTTP 200); blocks/icons/templates premium 401.
- Registry `@reui` sudah terdaftar di `components.json`; CLI terbukti via shadcn
  3.8.5 (catatan SHADCN.md). Strategi: coba CLI 4.21 dulu pada install pertama,
  fallback 3.8.5 bila gagal.
- Tanpa provider toaster (`sonner` belum ter-install).

## Peta kebutuhan → sumber

| Kebutuhan (dari audit) | reUI (free) | Fallback shadcn |
|---|---|---|
| Tombol | `c-button-*` | `ui/button` ✅ ada |
| Select (+optgroup timezone) | `c-select-*` | `ui/select` ✅ ada |
| Input teks/angka/password | `c-input-*`, `c-input-group-*` | `ui/input`, `ui/field` ✅ ada |
| Checkbox kategori | `c-checkbox-*` | baru (gap) |
| Switch "aktif" | `c-switch-*` | `ui/switch` ✅ ada |
| Kartu section/daftar | `c-card-*` | `ui/card` ✅ ada |
| Badge (H-x, tipe occasion, dot status) | `c-badge-*`, `c-avatar-*` | baru (gap) |
| Alert (banner warning/info) | `c-alert-*` | baru (gap) |
| AlertDialog (ganti `confirm()`) | `c-alert-dialog-*` | baru (gap) |
| Toast (tersimpan/tes channel/error mutasi) | `c-sonner-*` | baru (gap) |
| Skeleton/spinner (loading) | `c-skeleton-*`, `c-spinner-*` | baru (gap) |
| Date picker occasion | `c-calendar-*` / `c-date-selector-*` | `ui/calendar` ✅ ada |
| Progress ring kecil (pending) | `c-spinner-*` | baru (gap) |

Prinsip pemilihan contoh: ambil varian `c-*` yang **paling mendekati pemakaian
nyata** di halaman (bukan yang paling ramai animasinya), karena c-* membawa
primitif `@reui/*` + `ui/*` yang dibutuhkan secara otomatis (registryDependencies).

## Arsitektur pemasangan

- Sumber komponen: registry `@reui` (sudah terkonfigurasi, style `base-nova` →
  varian Base UI, sesuai stack proyek).
- Hasil install: contoh `c-*` → `src/components/examples/` (referensi pola, tidak
  diimpor route secara langsung bila berupa contoh sekali-pakai); primitif
  `@reui/*` → `src/components/reui/*`; primitif shadcn → `src/components/ui/*`.
  Route mengimpor **primitif** (reui/ui), bukan menyalin isi contoh — contoh hanya
  pemandu komposisi. (Pengecualian: bila sebuah contoh memang komponen jadi yang
  dipakai langsung — mis. date-picker — boleh diimpor langsung seperti event-calendar
  sekarang.)
- `<Toaster />` (sonner) dimount sekali di `__root.tsx`.
- Dependensi npm baru mengikuti kebutuhan contoh (mis. `sonner`); divalidasi
  lewat `tsc -b` tiap fase.

## Fase eksekusi (tiap fase diakhiri `npm run build` + verifikasi visual browser)

- **Fase 0 — Fondasi & branch**
  - Buat branch `feature/reui-refactor`.
  - Install contoh fondasi: button, select, input(-group), checkbox, switch, card,
    badge, alert, alert-dialog, sonner, skeleton, spinner (CLI 4.21 → fallback 3.8.5).
  - Mount `<Toaster />` di `__root.tsx`; build hijau sebagai baseline.
- **Fase 1 — Settings (pilot)**: ganti native select → `Select`, input → `Input`/
  `Field`, checkbox kategori → `Checkbox`, tombol Simpan → `Button` + toast
  "Tersimpan.", error mutasi → toast destructive, kartu → `Card`.
- **Fase 2 — Channels**: daftar channel → `Card` + `Badge` status; "aktif" →
  `Switch`; Tes → `Button` outline + toast hasil; Hapus → `AlertDialog` (ganti
  `confirm()`); form tambah → `Select` + `Input`/`InputGroup` (password) + `Button`;
  catatan enkripsi → `Alert` info.
- **Fase 3 — Contacts list + detail**: list → `Card` + `Avatar` inisial; detail:
  occasion → `Badge` tipe + `Calendar`/date-picker; checkbox channel → `Checkbox`;
  preferensi → `Switch`; hapus kontak/occasion → `AlertDialog`; feedback → toast.
- **Fase 4 — Dashboard polish**: banner channel kosong → `Alert`; list upcoming →
  `Card` + `Badge` H-x (warna via token success/warning/destructive); loading →
  `Skeleton`.
- **Fase 5 — Perapian**: hapus class ad-hoc sisa, pastikan tidak ada native
  `confirm()`/select/input tersisa di route, `tsc -b` + build produksi hijau,
  verifikasi visual seluruh halaman.

## Verifikasi per fase

1. `npm run build` (tsc + vite) hijau.
2. Dev server + browser: halaman target ter-render, alur utama jalan (simpan
   settings, toggle channel, tambah occasion), tanpa error console.
3. `git status` bersih dari perubahan tak terduga (guard seperti trial beUI).

## Risiko & mitigasi

- Contoh `c-*` membawa gaya sendiri → mitigasi: pilih varian polos, semua warna
  via token tema yang sudah ada (slate/indigo → primary/muted), uji visual per fase.
- CLI 4.21 vs registry → fallback 3.8.5 (terbukti di SHADCN.md).
- Route memakai react-query intensif → perubahan murni presentasional; logika
  mutasi/query tidak disentuh.

## Di luar lingkup

- Event calendar (sudah reUI), __root nav (cukup), backend/API, auth.
- Komponen premium reUI (blocks/icons/templates berbayar).
