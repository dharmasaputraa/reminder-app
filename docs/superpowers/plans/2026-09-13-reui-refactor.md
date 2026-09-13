# Refactor UI otorem ke reUI + App Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor seluruh UI `web/` otorem agar memakai komponen reUI (fallback shadcn), plus app shell sidebar (launcher "Autoreminder") dengan navbar horizontal di header konten.

**Architecture:** Fondasi primitif di-install dulu via contoh `c-*` reUI (registry `@reui`, style `base-nova`/Base UI), lalu app shell shadcn sidebar di-port ke Vite + TanStack Router + Tailwind v4, lalu tiap halaman di-refactor satu per satu di dalam shell. Logika react-query/route tidak diubah kecuali menambah toast di callback mutasi.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, TanStack Router/Query, shadcn CLI (registry `@reui` + registry resmi shadcn untuk block `sidebar`), sonner, Base UI (`@base-ui/react`), lucide-react, date-fns.

**Spec:** `docs/superpowers/specs/2026-09-13-reui-refactor-design.md`

## Global Constraints

- Semua command frontend dijalankan dari `web/`.
- Aturan sumber komponen: **reUI dulu, shadcn jika tidak ada**.
- CLI strategy: `npx shadcn add …` (4.21); bila gagal/registry error → `npx shadcn@3.8.5 add …` (terbukti di `web/SHADCN.md`).
- **Tidak ada test-runner frontend di proyek ini** (tanpa vitest/jest). Gate tiap task = `npm run build` hijau (tsc + vite) + `npm run lint` (oxlint) bersih + verifikasi visual browser (dev server `npm run dev` + skill browser-use) + `git status` bebas perubahan tak terduga. Ini pengganti siklus TDD untuk proyek ini — jangan menambah framework test.
- Jangan menyentuh: `src/components/reui/event-calendar/**`, backend Go, file WIP pengguna lain (`src/index.css` hanya bila step menyuruh).
- Gaya commit repo: conventional commit + deskripsi Indonesia, mis. `feat(web): …`.
- Primitif Base UI yang sudah ada dan dipakai plan ini (jangan ditulis ulang):
  - `Button` varian `default | outline | secondary | ghost | destructive | link`, size `default | xs | sm | lg | icon | icon-sm | …` (`ui/button.tsx`).
  - `Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem` — props Base UI: `value`, `onValueChange` (`ui/select.tsx`).
  - `Switch` — props Base UI: `checked`, `onCheckedChange`, size `sm|default` (`ui/switch.tsx`).
  - `Calendar` (react-day-picker, `mode="single"`, props `selected`/`onSelect`) (`ui/calendar.tsx`).
  - `Popover, PopoverTrigger, PopoverContent`, `Field, FieldLabel, FieldDescription`, `Separator`, `Input`, `Label`, `Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter` (`ui/*`).
- Komponen yang dihasilkan install (nama file/API standar base-nova): `ui/alert*`, `ui/badge`, `ui/checkbox`, `ui/sonner`, `ui/avatar`, `ui/sidebar`, `ui/sheet`, `ui/skeleton`. Jika nama sub-komponen hasil install sedikit berbeda dari yang dipakai di kode task, **ikuti file hasil install** (bukan mengubah primitif).
- Setelah setiap install registry: `git -C … status --porcelain -- web/` dan pastikan hanya file komponen/lockfile yang berubah; file lain yang ter-modifikasi tak terduga → `git checkout -- <file>`.

---

### Task 1: Branch + fondasi primitif reUI + Toaster

**Files:**
- Create (via CLI): `src/components/ui/alert.tsx`, `src/components/ui/alert-dialog.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/checkbox.tsx`, `src/components/ui/sonner.tsx`, `src/components/ui/avatar.tsx`
- Create (via CLI): `src/components/examples/c-alert-1.tsx`, `c-alert-dialog-1.tsx`, `c-badge-1.tsx`, `c-checkbox-1.tsx`, `c-sonner-1.tsx`, `c-avatar-1.tsx`
- Modify: `src/routes/__root.tsx` (mount `<Toaster />` sementara — Task 4 menulis ulang penuh)

**Interfaces:**
- Produces: `Alert, AlertTitle, AlertDescription`, `AlertDialog*`, `Badge` (varian standar), `Checkbox` (Base UI: `checked`, `onCheckedChange`), `Avatar, AvatarImage, AvatarFallback`, `Toaster` — dipakai Task 5–9.

- [ ] **Step 1: Buat branch kerja**

```bash
git -C /Users/taksu/Work/code/otorem checkout -b feature/reui-refactor
```

- [ ] **Step 2: Install enam contoh fondasi dari registry @reui**

```bash
cd /Users/taksu/Work/code/otorem/web
npx shadcn add @reui/c-alert-1 @reui/c-alert-dialog-1 @reui/c-badge-1 @reui/c-checkbox-1 @reui/c-sonner-1 @reui/c-avatar-1
```

Bila error registry/schema → jalankan ulang per item dengan `npx shadcn@3.8.5 add @reui/c-<nama>-1`. Verifikasi file yang dihasilkan ada di `src/components/ui/` (alert, alert-dialog, badge, checkbox, sonner, avatar). Bila ada primitif yang TIDAK ikut ter-install oleh contoh (contoh tidak mendeklarasikan dependency), install primitifnya langsung dari registry resmi: `npx shadcn add alert` (atau `badge`/`checkbox`/`sonner`/`avatar`/`alert-dialog`).

- [ ] **Step 3: Periksa `ui/sonner.tsx` — buang dependensi Next.js bila ada**

Bila file hasil install mengimpor `next-themes` (template Next), ganti seluruh isi jadi:

```tsx
import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster({ ...props }: ToasterProps) {
  return <Sonner position="top-right" {...props} />
}

export { Toaster }
```

(Package `sonner` pasti sudah ter-install oleh CLI; bila belum: `npm install sonner`.)

- [ ] **Step 4: Mount Toaster di root**

`src/routes/__root.tsx` — tambah import dan bungkus layout:

```tsx
import { Toaster } from '@/components/ui/sonner'
// di dalam component root, sebelum <Outlet />:
<Toaster />
```

- [ ] **Step 5: Build + lint hijau**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: `✓ built in …` tanpa error TS; oxlint tanpa error.

- [ ] **Step 6: Commit**

```bash
git add src/components src/routes/__root.tsx package.json package-lock.json
git commit -m "feat(web): fondasi primitif reui — alert, alert-dialog, badge, checkbox, sonner, avatar"
```

---

### Task 2: Block sidebar shadcn + porting Tailwind v4 / TanStack

**Files:**
- Create (via CLI): `src/components/ui/sidebar.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/skeleton.tsx`
- Create (bila CLI tidak menambahkannya): `src/hooks/use-mobile.ts`
- Modify: `src/components/ui/sidebar.tsx` (porting)

**Interfaces:**
- Produces: `SidebarProvider, Sidebar, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar` — dipakai Task 3–4. `Skeleton` dipakai Task 9.

- [ ] **Step 1: Install block sidebar**

```bash
cd /Users/taksu/Work/code/otorem/web
npx shadcn add sidebar
```

(Block ini dari registry resmi shadcn; sekaligus membuat `ui/sheet.tsx` + `ui/skeleton.tsx` yang jadi dependensinya.)

- [ ] **Step 2: Pastikan hook mobile tersedia**

`grep -n "use-mobile\|useMediaQuery\|useIsMobile" src/components/ui/sidebar.tsx`. Bila mengimpor `@/hooks/use-mobile` dan file itu tidak ada, buat `src/hooks/use-mobile.ts`:

```ts
import * as React from 'react'

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = () => setIsMobile(window.innerWidth < 767)
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < 767)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
```

- [ ] **Step 3: Porting sidebar.tsx ke stack proyek**

Di `src/components/ui/sidebar.tsx`:

1. Hapus `'use client'` dan import `usePathname` dari `next/navigation` (bila ada). Ganti pemakaiannya (efek close-sheet saat pindah halaman) dengan TanStack Router:

```tsx
import { useRouterState } from '@tanstack/react-router'
// di dalam function Sidebar(...) :
const pathname = useRouterState({ select: (s) => s.location.pathname })
React.useEffect(() => { setOpenMobile(false) }, [pathname, setOpenMobile])
```

2. Ganti semua sisa sintaks Tailwind v3 untuk variabel CSS: `w-[--sidebar-width]` → `w-(--sidebar-width)`, `w-[--sidebar-width-icon]` → `w-(--sidebar-width-icon)`, `max-w-[--skeleton-width]` → `max-w-(--skeleton-width)`, dan `w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]` → `w-[calc(var(--sidebar-width-icon)+var(--spacing)*4)]` (dengan semua variannya di baris `floating|inset`).
3. Bila ada class `hsl(var(--sidebar-…))`, ganti jadi `var(--sidebar-…)` (token proyek sudah oklch penuh).

- [ ] **Step 4: Build hijau**

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in …` (sidebar belum dipakai route; tsc harus tetap lolos).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui src/hooks package.json package-lock.json
git commit -m "feat(web): block sidebar shadcn + porting tailwind v4 & tanstack router"
```

---

### Task 3: AppSidebar (logo + menu data-driven)

**Files:**
- Create: `web/public/logo-w.svg` (salin dari `/Users/taksu/.openclaw-autoclaw/agents/auto-designer/workspace/logo-w.svg`)
- Create: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `Sidebar*` dari Task 2.
- Produces: `AppSidebar` (dipakai Task 4), `SIDEBAR_MODULES` (array `{ to: string; label: string }`) sebagai konfigurasi menu data-driven.

- [ ] **Step 1: Salin logo**

```bash
cp /Users/taksu/.openclaw-autoclaw/agents/auto-designer/workspace/logo-w.svg /Users/taksu/Work/code/otorem/web/public/logo-w.svg
```

- [ ] **Step 2: Tulis AppSidebar**

`src/components/app-sidebar.tsx`:

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { BellRingIcon } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

/** Menu sidebar data-driven — modul self-app baru (catatan, kebiasaan, dst.)
 *  tinggal nambah entri di sini (spec: visi aplikasi ingatan). */
export const SIDEBAR_MODULES = [{ to: '/', label: 'Autoreminder' }] as const

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="otorem">
              <Link to="/">
                <img src="/logo-w.svg" alt="Logo otorem" className="size-7" />
                <span className="text-base font-black tracking-tight">otorem</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>App</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SIDEBAR_MODULES.map((m) => (
                <SidebarMenuItem key={m.to}>
                  <SidebarMenuButton asChild tooltip={m.label} isActive={pathname === m.to}>
                    <Link to={m.to}>
                      <BellRingIcon />
                      <span>{m.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
```

- [ ] **Step 3: Build hijau**

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in …`

- [ ] **Step 4: Commit**

```bash
git add public/logo-w.svg src/components/app-sidebar.tsx
git commit -m "feat(web): appsidebar — logo otorem + menu data-driven"
```

---

### Task 4: __root sebagai shell (sidebar + navbar horizontal)

**Files:**
- Modify (tulis ulang): `src/routes/__root.tsx`

**Interfaces:**
- Consumes: `AppSidebar`, `SidebarProvider/SidebarInset/SidebarTrigger` (Task 2–3), `Toaster` (Task 1).
- Produces: layout shell untuk semua route; navbar 4 link dengan state aktif.

- [ ] **Step 1: Tulis ulang __root.tsx**

```tsx
import { Link, createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { Separator } from '@base-ui/react/separator'
import { Toaster } from '@/components/ui/sonner'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/contacts', label: 'Kontak' },
  { to: '/channels', label: 'Channel' },
  { to: '/settings', label: 'Pengaturan' },
] as const

export const Route = createRootRoute({
  component: () => (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="!h-4" />
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                activeProps={{ className: 'font-bold text-indigo-700' }}
                className="transition-colors hover:text-foreground data-[status=active]:font-bold"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 p-4">
          <div className="mx-auto w-full max-w-2xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  ),
})
```

Catatan: bila `Separator` dari `@base-ui/react/separator` tidak diekspor di versi terpasang, pakai `import { Separator } from '@/components/ui/separator'` (primitif proyek).

- [ ] **Step 2: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: hijau keduanya.

- [ ] **Step 3: Verifikasi visual shell**

Run: `npm run dev` (background; catat port — 5173 bisa terpakai, cek output).
Browser (skill browser-use): buka `http://localhost:<port>/`.
- Sidebar tampil: logo + nama "otorem" + menu "Autoreminder" aktif di `/`.
- Navbar horizontal: "Dashboard" tebal saat di `/`; klik "Kontak" → Kontak jadi tebal, Dashboard tidak.
- Toggle sidebar (klik trigger): collapse ke rail ikon; `Ctrl/Cmd+B` juga berfungsi.
- Sempitkan viewport < 768px: sidebar jadi Sheet (trigger membuka panel geser).
- Console tanpa error.
Tutup dev server setelah selesai.

- [ ] **Step 4: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat(web): app shell — sidebar launcher + navbar horizontal"
```

---

### Task 5: Fase Settings (pilot)

**Files:**
- Modify (tulis ulang): `src/routes/settings.tsx`

**Interfaces:**
- Consumes: `Select*`, `Checkbox`, `Button`, `Card*`, `Field*`, `Input`, `Toaster` (sudah mounted, pakai `toast` dari `sonner`).

- [ ] **Step 1: Tulis ulang settings.tsx**

Ganti seluruh isi `src/routes/settings.tsx` (konstanta `KATEGORI`, `TZ_INDONESIA`, `TZ_LAINNYA`, `gmtOffset`, `tzOptionText` dibiarkan sama persis seperti sekarang — jangan diubah):

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Settings } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

// … KATEGORI, TZ_INDONESIA, TZ_LAINNYA, gmtOffset, tzOptionText: TETAP seperti file lama …

function SettingsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const [form, setForm] = useState<Settings | null>(null)
  const [offsetsText, setOffsetsText] = useState('')

  useEffect(() => {
    if (q.data && !form) {
      setForm(q.data)
      setOffsetsText(q.data.default_offsets.join(','))
    }
  }, [q.data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api('/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Tersimpan.')
    },
    onError: (e) => toast.error(`Gagal menyimpan: ${String(e)}`),
  })

  if (!form && q.isError)
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Pengaturan</h1>
        <p className="text-sm text-red-600">
          Gagal memuat pengaturan: {String(q.error)} — periksa login/dev email lalu muat ulang halaman.
        </p>
      </div>
    )
  if (!form) return <p className="text-slate-500">Memuat…</p>
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })
  const saveNow = () =>
    save.mutate({
      ...form,
      default_offsets: offsetsText.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)),
    })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Pengaturan</h1>

      <Card>
        <CardHeader>
          <CardTitle>Preferensi Pengingat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Timezone</FieldLabel>
            <Select value={form.timezone} onValueChange={(v) => set({ timezone: v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih zona waktu" />
              </SelectTrigger>
              <SelectContent>
                {/* nilai tersimpan yang tidak ada di list tetap tampil */}
                {!TZ_INDONESIA.some((t) => t.value === form.timezone) &&
                  !TZ_LAINNYA.includes(form.timezone) && (
                  <SelectItem value={form.timezone}>{tzOptionText(form.timezone)} — nilai tersimpan</SelectItem>
                )}
                <SelectGroup>
                  <SelectLabel>Indonesia</SelectLabel>
                  {TZ_INDONESIA.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{tzOptionText(t.value, t.name)}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Zona waktu lainnya</SelectLabel>
                  {TZ_LAINNYA.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tzOptionText(tz)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>Menentukan "hari ini" untuk kalender dan jam kirim pengingat.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="send-time">Jam kirim (HH:MM)</FieldLabel>
            <Input id="send-time" value={form.send_time} onChange={(e) => set({ send_time: e.target.value })} />
          </Field>

          <Field>
            <FieldLabel htmlFor="catch-up">Catch-up window (jam)</FieldLabel>
            <Input
              id="catch-up"
              type="number"
              value={form.catch_up_hours}
              onChange={(e) => set({ catch_up_hours: Number(e.target.value) })}
            />
            <FieldDescription>Pengingat yang terlewat karena perangkat mati.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="offsets">Offset default (hari sebelum H, pisah koma)</FieldLabel>
            <Input id="offsets" value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kategori hari raya</legend>
            {KATEGORI.map((k) => (
              <label key={k.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.holiday_categories[k.key] ?? false}
                  onCheckedChange={(c) => set({ holiday_categories: { ...form.holiday_categories, [k.key]: c === true } })}
                />
                {k.label}
              </label>
            ))}
          </fieldset>

          <Button onClick={saveNow} disabled={save.isPending}>Simpan</Button>
        </CardContent>
      </Card>

      {me.data && (
        <p className="text-sm text-slate-500">
          Masuk sebagai <b>{me.data.email}</b> ({me.data.role}) — mode dev via header X-Dev-Email;
          produksi via Cloudflare Access.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: hijau. (Bila `onValueChange` beda tanda tangan di base-nova — cek `ui/select.tsx`/tipenya dan sesuaikan.)

- [ ] **Step 3: Verifikasi visual**

Dev server + browser → `/settings`: select timezone terbuka berisi grup Indonesia/lainnya; checkbox toggle; ubah sesuatu → Simpan → toast "Tersimpan." muncul di kanan atas; console bersih.

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "feat(web): refactor settings ke primitif ui + toast"
```

---

### Task 6: Fase Channels

**Files:**
- Modify (tulis ulang): `src/routes/channels.tsx`

**Interfaces:**
- Consumes: primitif Task 1–2 + `Switch`, `AlertDialog*`, `Badge`, `Input`.

- [ ] **Step 1: Tulis ulang channels.tsx**

Konstanta `TIPE`, `FIELDS` tetap sama. State `testResult` **dihapus** (hasil tes lewat toast). Mutasi `test` disederhanakan:

```tsx
const test = useMutation({
  mutationFn: (id: number) => api(`/channels/${id}/test`, { method: 'POST' }),
  onSuccess: () => toast.success('Tes berhasil — notifikasi terkirim.'),
  onError: (e) => toast.error(`Tes gagal: ${String(e)}`),
})
```

JSX daftar channel (pengganti blok `q.data?.channels.map(...)` lama):

```tsx
{q.data?.channels.map((ch) => (
  <Card key={ch.id} className="flex flex-row items-center gap-3 p-3">
    <Badge variant={ch.enabled ? 'default' : 'secondary'}>{ch.type}</Badge>
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium">{ch.name}</p>
      <p className="text-xs text-slate-400">{ch.enabled ? 'aktif' : 'nonaktif'}</p>
    </div>
    <label className="flex items-center gap-1.5 text-sm">
      <Switch
        checked={ch.enabled}
        onCheckedChange={(v) => toggle.mutate({ id: ch.id, enabled: v === true })}
      />
      aktif
    </label>
    <Button variant="outline" size="sm" onClick={() => test.mutate(ch.id)} disabled={test.isPending}>
      Tes
    </Button>
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">Hapus</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus channel {ch.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Channel tidak bisa dipakai lagi untuk mengirim pengingat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={() => del.mutate(ch.id)}>Hapus</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Card>
))}
```

Form "Tambah Channel": bungkus dengan `Card` (+`CardHeader`/`CardTitle`), ganti native select → `Select`+`SelectTrigger`+`SelectContent`+`SelectItem` (nilai `type`, `onValueChange={(v) => { setType(v as typeof type); setCfg({}) }}`), semua native `<input>` → `Input` (`type` mengikuti `f.type`, password tetap `type="password"`), tombol Simpan → `<Button type="submit" disabled={!name.trim() || create.isPending}>Simpan</Button>`, dan paragraf info enkripsi → `Alert`:

```tsx
<Alert>
  <AlertTitle>Config disimpan terenkripsi (AES-256-GCM)</AlertTitle>
  <AlertDescription>Tidak bisa dilihat lagi setelah disimpan.</AlertDescription>
</Alert>
```

Tambah `import { toast } from 'sonner'` dan hapus import yang tidak terpakai.

- [ ] **Step 2: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: hijau.

- [ ] **Step 3: Verifikasi visual**

`/channels`: toggle Switch mengubah aktif/nonaktif (badge & teks ikut berubah), tombol Tes memunculkan toast sukses/gagal, Hapus memunculkan AlertDialog (Batal tidak menghapus, Hapus menghapus), form tambah dengan select type bekerja.

- [ ] **Step 4: Commit**

```bash
git add src/routes/channels.tsx
git commit -m "feat(web): refactor channels — switch, alert-dialog, toast"
```

---

### Task 7: Fase Contacts (list + detail)

**Files:**
- Modify (tulis ulang): `src/routes/contacts.index.tsx`
- Modify (tulis ulang): `src/routes/contacts.$id.tsx`

**Interfaces:**
- Consumes: primitif Task 1–2 + `Avatar, AvatarFallback`, `Badge`, `Calendar`, `Popover*`, `Switch`, `AlertDialog*`. `format` dari `date-fns` (sudah ada).

- [ ] **Step 1: Tulis ulang contacts.index.tsx**

Form tetap (native input → `Input`, tombol → `Button`). Baris kontak jadi Card + Avatar inisial:

```tsx
function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}
```

```tsx
{q.data?.contacts.map((c) => (
  <Link key={c.id} to="/contacts/$id" params={{ id: String(c.id) }} className="block">
    <Card className="flex-row items-center gap-3 p-3 transition-colors hover:border-indigo-300">
      <Avatar>
        <AvatarFallback>{initials(c.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{c.name}{c.nickname ? ` · ${c.nickname}` : ''}</p>
        <p className="truncate text-sm text-slate-500">
          {c.occasions.length === 0
            ? 'belum ada occasion'
            : c.occasions.map((o) => `${o.type} ${o.base_date}`).join(' · ')}
        </p>
      </div>
    </Card>
  </Link>
))}
```

- [ ] **Step 2: Tulis ulang contacts.$id.tsx**

Logika mutasi/query (`previewPawukon`, `addOcc`, `delOcc`, `savePrefs`, `delContact`, `hydratePrefsForm`) **tetap sama**. Perubahan presentasional:

1. Section → `Card`+`CardHeader`+`CardTitle`+`CardContent` (dua section: Occasions, Preferensi Pengingat).
2. Chip tipe occasion → `<Badge variant="secondary" className="uppercase">{o.type}</Badge>`.
3. Native select tipe → `Select`+`SelectItem` dari `TIPE`.
4. Native `<input type="date">` → date picker Popover + Calendar:

```tsx
const [dateObj, setDateObj] = useState<Date | undefined>(undefined)
const [dateOpen, setDateOpen] = useState(false)
// …
<Popover open={dateOpen} onOpenChange={setDateOpen}>
  <PopoverTrigger asChild>
    <Button variant="outline" className="justify-start font-normal">
      <CalendarIcon className="size-4" />
      {dateObj ? format(dateObj, 'yyyy-MM-dd') : 'Pilih tanggal'}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0" align="start">
    <Calendar
      mode="single"
      selected={dateObj}
      onSelect={(d) => {
        setDateObj(d)
        const iso = d ? format(d, 'yyyy-MM-dd') : ''
        setDate(iso)
        setDateOpen(false)
        previewPawukon(iso)
      }}
    />
  </PopoverContent>
</Popover>
```

(import `CalendarIcon` dari lucide, `format` dari date-fns, `Calendar` dari `@/components/ui/calendar`.)

5. Checkbox "aktif" (preferensi) → `Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)}`; checkbox per-channel TETAP `Checkbox` (multi-pilihan) dengan `onCheckedChange` logika Set yang sama.
6. Tombol hapus kontak & hapus occasion → `AlertDialog` (pola sama persis dengan Task 6; untuk occasion tanpa judul panjang: title `Hapus occasion ini?`).
7. Tombol aksi → `Button` (Tambah = default, Simpan preferensi = default, batal = outline).
8. Feedback: `{savePrefs.isError && …}` → `toast.error` di `onError` mutasi `savePrefs` (tambahkan onError; onSuccess tetap `invalidate()`).

- [ ] **Step 3: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: hijau.

- [ ] **Step 4: Verifikasi visual**

`/contacts`: tambah kontak, kartu muncul dengan avatar inisial. Buka detail: pilih tanggal via kalender popover → preview pawukon muncul untuk type otongan; tambah occasion → list bertambah dengan badge tipe; toggle aktif + simpan preferensi → tanpa error; hapus occasion & hapus kontak lewat AlertDialog (hapus kontak kembali ke list).

- [ ] **Step 5: Commit**

```bash
git add src/routes/contacts.index.tsx src/routes/contacts.\$id.tsx
git commit -m "feat(web): refactor contacts — card, avatar, date picker, alert-dialog"
```

---

### Task 8: Fase Dashboard polish

**Files:**
- Modify: `src/routes/index.tsx` (calendar & nav EventCalendar **tidak disentuh**)

**Interfaces:**
- Consumes: `Alert*`, `Badge`, `Skeleton`, `Card` (Task 1–2).

- [ ] **Step 1: Ganti banner channel kosong dengan Alert**

Blok `{channels.data && channels.data.channels.length === 0 && (…)}`:

```tsx
{channels.data && channels.data.channels.length === 0 && (
  <Alert>
    <AlertTitle>Belum ada channel notifikasi</AlertTitle>
    <AlertDescription>
      Tambah dulu supaya pengingat benar-benar terkirim —{' '}
      <Link to="/channels" className="underline">tambah channel</Link>
    </AlertDescription>
  </Alert>
)}
```

- [ ] **Step 2: Loading → Skeleton**

```tsx
if (up.isLoading)
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-[560px] w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  )
```

- [ ] **Step 3: Kartu upcoming → Card + Badge**

Ganti lingkaran `badgeClass` + kartu manual. Fungsi urgensi baru (token tema):

```tsx
function urgencyClass(days: number): string {
  if (days <= 0) return 'bg-destructive text-destructive-foreground'
  if (days <= 3) return 'bg-warning text-warning-foreground'
  if (days <= 7) return 'bg-amber-400 text-amber-950'
  return 'bg-muted text-muted-foreground'
}
```

Baris item:

```tsx
<Card key={…} className="flex-row items-center gap-3 p-3">
  <Badge className={`h-11 w-11 rounded-full text-xs font-bold ${urgencyClass(it.days_until)}`}>
    {it.days_until <= 0 ? 'HARI H' : `H-${it.days_until}`}
  </Badge>
  <div className="min-w-0 flex-1"> …isi lama… </div>
  <div className="hidden shrink-0 gap-1 sm:flex">
    {it.reminders?.map((r) => (
      <Badge key={r} variant="secondary">H-{r}</Badge>
    ))}
  </div>
</Card>
```

Hapus fungsi `badgeClass` lama. Import `Alert, AlertTitle, AlertDescription`, `Badge`, `Card`, `Skeleton`.

- [ ] **Step 4: Build + lint + verifikasi visual**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Browser `/`: kalender event-calendar tidak berubah; banner Alert muncul hanya bila tanpa channel; list upcoming tampil dengan badge H-x berwarna bertingkat; skeleton terlihat saat reload dengan network lambat (throttle).

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(web): dashboard polish — alert, badge, skeleton"
```

---

### Task 9: Perapian + sweep akhir

**Files:**
- Modify: `web/SHADCN.md` (catatan install sidebar)
- Sweep semua route

- [ ] **Step 1: Pastikan tidak ada elemen native tersisa**

```bash
grep -rn "confirm(" src/routes/ ; grep -rn "<select" src/routes/ ; grep -rn 'type="checkbox"' src/routes/
```

Expected: tidak ada hasil. Bila ada → refactor sisa itu dengan pola Task yang sesuai.

- [ ] **Step 2: Lint + build produksi**

Run: `npm run lint && npm run build 2>&1 | tail -3`
Expected: keduanya hijau.

- [ ] **Step 3: Verifikasi visual menyeluruh**

Dev server + browser: kunjungi `/`, `/contacts`, `/contacts/1`, `/channels`, `/settings` — shell konsisten (sidebar + navbar), tidak ada layout rusak, console bersih di semua halaman. Tutup dev server.

- [ ] **Step 4: Catat decision di SHADCN.md**

Tambah di akhir `web/SHADCN.md`:

```
- Sidebar (shell) di-install dari registry resmi shadcn (`npx shadcn add sidebar`) — reUI tidak punya keluarga sidebar; di-port ke TanStack Router (`useRouterState` pengganti `usePathname`) & Tailwind v4 (`w-(--sidebar-width)`), token `--color-sidebar*` sudah tersedia base-nova.
```

- [ ] **Step 5: Commit**

```bash
git add SHADCN.md src/routes
git commit -m "chore(web): perapian pasca refactor + catatan sidebar"
```

---

## Self-Review (sudah dijalankan penulis plan)

1. **Spec coverage**: Fase 0 → Task 1; shell → Task 2–4; Settings → Task 5; Channels → Task 6; Contacts → Task 7; Dashboard → Task 8; perapian → Task 9; logo & NAV_CONFIG → Task 3; visi data-driven → `SIDEBAR_MODULES` Task 3. Tidak ada bagian spec tanpa task.
2. **Placeholder**: konstanta/settings yang tidak berubah diberi perintah eksplisit "TETAP seperti file lama" dengan konteks file yang sama di repo — bukan placeholder logika baru.
3. **Type consistency**: `SIDEBAR_MODULES`/`AppSidebar` (Task 3) dipakai Task 4; `Toaster` (Task 1) dipakai Task 4; `Skeleton` (Task 2) dipakai Task 8; semua props Base UI (`onCheckedChange`, `onValueChange`) konsisten dengan catatan Global Constraints.
