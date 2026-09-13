# beUI Button Trial — Design

Tanggal: 2026-09-13
Status: disetujui (pengguna, percakapan)

> **EPILOG (2026-09-13):** Trial ini ternyata berbasis salah paham — komponen yang
> dimaksud pengguna adalah **reUI** (reui.io), bukan beUI. Semua file beUI telah
> dihapus dan `motion` di-uninstall (tree diverifikasi identik dengan HEAD). Spec
> ini disimpan sebagai catatan teknis: beUI registry tidak kompatibel shadcn CLI,
> instalasi manualesk per `llms.txt` beUI terbukti berfungsi penuh bila suatu saat
> diperlukan.

## Tujuan

Menguji integrasi [beUI](https://beui.dev/) (komponen animasi React 19 + Tailwind v4,
distribusi ala shadcn registry, lisensi MIT) ke frontend `web/` proyek otorem, dengan
memasang **satu komponen uji coba: `@beui/button`** (berisi `Button`, `ButtonLink`,
`StatefulButton`, `MagneticButton`, `MetallicButton`).

Kriteria berhasil:

1. `npm run build` (tsc + vite) lolos tanpa error TS.
2. Keempat varian button ter-render dan animasi spring-nya jalan di browser, tanpa
   error console.
3. Tidak ada file bawaan proyek yang berubah (khususnya `src/components/ui/button.tsx`
   dan `src/lib/utils.ts`).

## Konteks

- Stack `web/`: React 19, Vite, Tailwind CSS v4, TanStack Router, shadcn CLI (style
  `base-nova`, komponen Base UI/Radix di `src/components/ui/`) — cocok dengan
  requirement beUI.
- beUI menyediakan registry shadcn di `https://beui.dev/r/{name}` (JSON tanpa ekstensi;
  `/{name}.json` mengembalikan 404).
- Item `button` menulis ke `components/motion/button/*` (TIDAK menimpa
  `components/ui/button.tsx` bawaan) plus helper: `lib/ease.ts`,
  `lib/hooks/use-hover-capable.ts`, `lib/utils.ts`, `components/motion/magnetic.tsx`.
- Dependencies yang akan bertambah: `motion`, `clsx`, `tailwind-merge` (belum ada di
  proyek).

## Pendekatan yang dipilih

**shadcn CLI dengan registry terdaftar** (bukan fetch manual, bukan sandbox terpisah):

1. Tambah `"@beui": "https://beui.dev/r/{name}"` ke `registries` di
   `web/components.json` (mengikuti pola `@reui` yang sudah ada).
2. `npx shadcn add @beui/button` di `web/` — CLI memasang dependencies dan menulis
   file sesuai path di item JSON.
3. Guard: cek `git diff` pada `src/lib/utils.ts`; jika CLI menimpanya, restore versi
   lama (`cn` bawaan proyek tetap jadi sumber kebenaran; import `@/lib/utils` milik
   beUI tetap resolve ke file yang sama).
4. Demo temporer: route sementara `/demo` (bukan halaman index, agar tidak bergantung
   pada API backend) yang me-render keempat varian button.
5. Verifikasi: `npm run build` + cek visual via browser (dev server Vite, screenshot,
   cek error console).
6. Bersih-bersih: hapus route demo + regenerate `routeTree.gen.ts`; registry config,
   dependencies, dan file komponen **tetap** untuk pemakaian lanjutan.

## Rollback

- Perubahan file: `git checkout` / hapus file baru.
- Dependencies: `npm rm motion clsx tailwind-merge`.
- `components.json`: hapus entry `@beui`.

## Di luar lingkup

- Pemakaian button pada halaman sungguhan (menunggu keputusan setelah trial).
- Komponen beUI lain (Toast Stack, dll.).
- Tier beUI Pro (pro.beui.dev) — tidak dipakai.

## Catatan pasca-trial (hasil eksekusi 2026-09-13)

- Registry `@beui` ternyata **tidak kompatibel dengan shadcn CLI** (4.21.0 & 4.20.0):
  `https://beui.dev/r/{name}` mengembalikan format custom beUI tanpa `type: registry:*`,
  dan `/{name}.json` 404. Sesuai `llms.txt` mereka, jalur resmi memang penempatan manual
  oleh agent. Entry `@beui` tidak didaftarkan di `components.json` (dibatalkan).
- Install manual sukses: 8 file dari item JSON ditulis (1 di-skip: `lib/utils.ts` —
  guard jalan, file proyek tak tersentuh), dep baru hanya `motion`.
- Verifikasi: `npm run build` (tsc + vite) hijau; visual di browser — 8 varian Button
  ter-render dengan token shadcn, siklus StatefulButton idle → loading → success → idle
  terbukti (klik + tangkapan layar); Metallic shimmer dan kaskade huruf berjalan.
  Catatan: tombol beranimasi membuat Playwright actionability-check timeout — klik perlu
  jalur koordinat; bukan cacat komponen.
- Demo `/demo` dihapus, `routeTree.gen.ts` kembali identik. Perubahan yang tersisa di
  tree (tidak di-commit): `src/components/motion/**`, `src/lib/ease.ts`,
  `src/lib/hooks/**`, `components/motion/magnetic.tsx`, `package.json`/lock (+motion),
  catatan `web/SHADCN.md`.
- Deviasi kecil dari desain awal: demo memakai route `/demo` terpisah (bukan blok di
  halaman index) agar verifikasi tidak bergantung API backend.
