# otorem Plan 4/4: SPA + Embed + Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frontend React (Vite + TanStack Router/Query + Tailwind) lengkap yang di-embed ke binary Go, plus packaging Docker + compose (profile cloudflared/gotify/litestream) dan README operasional.

**Architecture:** SPA same-origin di `/` dilayani Gin via `NoRoute` + `go:embed` (fallback index.html untuk client-side routing; 503 jika belum di-build). Build pipeline: `make web` menyalin `web/dist` → `internal/api/webroot/`; Dockerfile multi-stage melakukan hal sama. API dipakai via `/api/v1` (dev auth: header `X-Dev-Email` dari localStorage).

**Tech Stack:** Node ≥ 22, Vite 6, React 18, TypeScript, `@tanstack/react-router` (file-based + plugin Vite), `@tanstack/react-query` v5, Tailwind CSS v4 (`@tailwindcss/vite`).

## Global Constraints

- Konsumsi endpoint persis seperti kontrak Plan 3 (lihat bagian bawah plan 3): `/upcoming`, `/contacts…`, `/channels…` (+ `POST /channels/:id/test`), `/settings`, `/pawukon?date=`, `/me`; header dev `X-Dev-Email`.
- Nol runtime Node di produksi — hasil build statis di-embed; `internal/api/webroot/*` di-gitignore KECUALI `.gitkeep`.
- UI Bahasa Indonesia; bukan goal v1: i18n, dark mode, unit test frontend (verifikasi via `npm run build` + smoke manual).
- File-based routing TanStack: `routeTree.gen.ts` digenerate plugin — jangan diedit manual, boleh di-gitignore.
- Setiap task: bangun → verifikasi (build/test) → commit.

---

### Task 1: Scaffold Vite + TanStack + Tailwind

**Files:**
- Create: `web/` (hasil scaffold), `web/vite.config.ts`, `web/src/index.css`, `web/src/main.tsx`, `web/src/routes/__root.tsx`
- Modify: `web/index.html`

**Interfaces:**
- Produces: aplikasi Vite jalan (`npm run dev` proxy `/api` → `:8080`); route tree file-based aktif; `QueryClient` tersedia via context router.

- [ ] **Step 1: Scaffold + install**

```bash
cd code && npm create vite@latest web -- --template react-ts
cd web && npm i @tanstack/react-router @tanstack/react-query && npm i -D @tanstack/router-plugin @tailwindcss/vite tailwindcss
rm -f src/App.css src/App.tsx src/assets/react.svg
```

- [ ] **Step 2: Konfigurasi Vite (router plugin + tailwind + proxy)**

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
})
```

- [ ] **Step 3: Entry + root route**

`web/src/index.css`:

```css
@import "tailwindcss";

body { @apply bg-slate-50 text-slate-900; }
```

`web/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import './index.css'

const queryClient = new QueryClient()
const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
```

`web/src/routes/__root.tsx`:

```tsx
import { Link, createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <span className="text-lg font-black tracking-tight">otorem 🛕</span>
        <nav className="flex gap-4 text-sm text-slate-600">
          <Link to="/" activeProps={{ className: 'font-bold text-indigo-700' }}>Dashboard</Link>
          <Link to="/contacts" activeProps={{ className: 'font-bold text-indigo-700' }}>Kontak</Link>
          <Link to="/channels" activeProps={{ className: 'font-bold text-indigo-700' }}>Channel</Link>
          <Link to="/settings" activeProps={{ className: 'font-bold text-indigo-700' }}>Pengaturan</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  ),
})
```

`web/index.html` — pastikan berisi (di dalam `<head>`, ganti title bawaan):

```html
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>otorem — pengingat otonan & ultah</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Verifikasi build**

```bash
npm run build && ls dist/
```
Expected: build sukses, `dist/index.html` ada (belum ada route selain root — `/` render header).

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/ && git commit -m "feat(web): scaffold vite + tanstack router/query + tailwind"
```
(`web/.gitignore` bawaan create-vite sudah menutup `node_modules`/`dist`.)

---

### Task 2: API client + halaman placeholder routes

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/routes/index.tsx`, `web/src/routes/contacts.index.tsx`, `web/src/routes/contacts.$id.tsx`, `web/src/routes/channels.tsx`, `web/src/routes/settings.tsx` (isi minimal di task ini; task berikutnya menuntaskan)

**Interfaces:**
- Produces: `api<T>(path, init?)` — fetch `/api/v1{path}`, inject `X-Dev-Email` dari localStorage, prompt sekali saat 401 dev; tipe `UpcomingItem`, `Contact`, `Occasion`, `Prefs`, `Channel`, `Settings`.

- [ ] **Step 1: Tulis API client**

`web/src/lib/api.ts`:

```ts
const devEmailKey = 'otorem-dev-email'

export function devEmail(): string | null { return localStorage.getItem(devEmailKey) }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const email = devEmail()
  if (email) headers.set('X-Dev-Email', email)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/v1${path}`, { ...init, headers })
  if (res.status === 401 && !email) {
    const entered = window.prompt('Mode dev: masukkan email Anda (admin jika terdaftar di ADMIN_EMAILS)')
    if (entered) {
      localStorage.setItem(devEmailKey, entered.trim().toLowerCase())
      return api<T>(path, init)
    }
  }
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).error ?? msg } catch { /* biarkan statusText */ }
    throw new ApiError(res.status, msg)
  }
  return res.json()
}

export interface UpcomingItem {
  date: string; kind: 'occasion' | 'holiday'
  occasion_id?: number; contact_id?: number; contact_name?: string
  type?: string; number?: number
  title: string; pawukon?: string; days_until: number; reminders?: number[]
}
export interface Occasion { id: number; type: string; base_date: string; label: string }
export interface Prefs { contact_id: number; offsets: number[]; channel_ids: number[]; enabled: boolean }
export interface Contact { id: number; name: string; nickname: string; notes: string; occasions: Occasion[]; prefs: Prefs | null }
export interface Channel { id: number; type: string; name: string; enabled: boolean }
export interface Settings {
  timezone: string; send_time: string; catch_up_hours: number
  default_offsets: number[]; holiday_categories: Record<string, boolean>
}
```

- [ ] **Step 2: Halaman placeholder agar route tree valid**

`web/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: () => <p>Dashboard (dikerjakan task 3)</p> })
```

`web/src/routes/contacts.index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contacts/')({ component: () => <p>Kontak (task 4)</p> })
```

`web/src/routes/contacts.$id.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contacts/$id')({ component: () => <p>Detail kontak (task 4)</p> })
```

`web/src/routes/channels.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/channels')({ component: () => <p>Channel (task 5)</p> })
```

`web/src/routes/settings.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({ component: () => <p>Pengaturan (task 6)</p> })
```

- [ ] **Step 3: Verifikasi + commit**

```bash
npm run build
```
Expected: sukses; `routeTree.gen.ts` tergenerate otomatis memuat 5 route.

```bash
cd .. && git add web/ && git commit -m "feat(web): api client bertipe + route placeholder"
```

---

### Task 3: Dashboard — timeline upcoming

**Files:**
- Modify: `web/src/routes/index.tsx` (ganti placeholder)

- [ ] **Step 1: Implementasi Dashboard**

`web/src/routes/index.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { api, type UpcomingItem } from '../lib/api'

export const Route = createFileRoute('/')({ component: Dashboard })

function useUpcoming(days = 30) {
  return useQuery({
    queryKey: ['upcoming', days],
    queryFn: () => api<{ today: string; items: UpcomingItem[] }>(`/upcoming?days=${days}`),
  })
}

function badgeClass(days: number): string {
  if (days <= 0) return 'bg-red-500'
  if (days <= 3) return 'bg-orange-500'
  if (days <= 7) return 'bg-amber-400'
  return 'bg-slate-400'
}

function Dashboard() {
  const up = useUpcoming()
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: unknown[] }>('/channels'),
  })

  if (up.isLoading) return <p className="text-slate-500">Memuat…</p>
  if (up.isError) return <p className="text-red-600">{String(up.error)}</p>

  const items = up.data?.items ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">30 Hari ke Depan</h1>
        <Link to="/contacts" className="text-sm text-indigo-600 hover:underline">Kelola Kontak</Link>
      </div>

      {channels.data && channels.data.channels.length === 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Belum ada channel notifikasi — <Link to="/channels" className="underline">tambah dulu</Link> supaya pengingat benar-benar terkirim.
        </div>
      )}
      {items.length === 0 && (
        <p className="text-slate-500">Tidak ada acara dalam 30 hari ke depan.</p>
      )}

      {items.map((it: UpcomingItem, i: number) => (
        <div key={`${it.kind}-${it.occasion_id ?? it.title}-${i}`}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${badgeClass(it.days_until)}`}>
            {it.days_until <= 0 ? 'HARI H' : `H-${it.days_until}`}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{it.title}</p>
            <p className="truncate text-sm text-slate-500">
              {it.kind === 'holiday' ? 'Hari raya' : it.contact_name} · {it.date}
              {it.pawukon ? ` · ${it.pawukon}` : ''}
            </p>
          </div>
          {it.reminders && (
            <div className="hidden shrink-0 gap-1 sm:flex">
              {it.reminders.map((r) => (
                <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">H-{r}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verifikasi visual (dev server + API dev mode)**

```bash
# terminal 1
APP_SECRET=dev-secret-panjang-16 AUTH_MODE=dev DATA_DIR=/tmp/otoremdata go run ./cmd/server
# terminal 2
cd web && npm run dev
```
Buka `http://localhost:5173` → isi email saat prompt → Dashboard tampil (boleh kosong). Buat kontak via `/contacts` (masih placeholder — buat via curl) dan pastikan item muncul:

```bash
curl -s -X POST -H 'X-Dev-Email: admin@x.id' -H 'Content-Type: application/json' \
  -d '{"name":"Made"}' localhost:8080/api/v1/contacts
curl -s -X POST -H 'X-Dev-Email: admin@x.id' -H 'Content-Type: application/json' \
  -d "{\"type\":\"otongan\",\"date\":\"$(date -u +%F -d '-210 days' 2>/dev/null || date -v-210d -u +%F)\"}" \
  localhost:8080/api/v1/contacts/1/occasions
```
Expected: item "Otonan ke-1 …" muncul di dashboard dengan badge H-0 merah.

- [ ] **Step 3: Commit**

```bash
git add web/ && git commit -m "feat(web): dashboard timeline upcoming dengan badge countdown"
```

---

### Task 4: Kontak — list, create, detail (occasions + prefs + preview pawukon)

**Files:**
- Modify: `web/src/routes/contacts.index.tsx`, `web/src/routes/contacts.$id.tsx`

- [ ] **Step 1: Halaman daftar kontak**

`web/src/routes/contacts.index.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Contact } from '../lib/api'

export const Route = createFileRoute('/contacts/')({ component: Contacts })

function Contacts() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['contacts'], queryFn: () => api<{ contacts: Contact[] }>('/contacts') })
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => api('/contacts', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['contacts'] }) },
  })

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Kontak</h1>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama (mis. Made Wijaya)"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2" />
        <button disabled={create.isPending || !name.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
          Tambah
        </button>
      </form>
      {q.data?.contacts.map((c) => (
        <Link key={c.id} to="/contacts/$id" params={{ id: String(c.id) }}
          className="block rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300">
          <p className="font-medium">{c.name}{c.nickname ? ` · ${c.nickname}` : ''}</p>
          <p className="text-sm text-slate-500">
            {c.occasions.length === 0
              ? 'belum ada occasion'
              : c.occasions.map((o) => `${o.type} ${o.base_date}`).join(' · ')}
          </p>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Halaman detail (occasions + prefs + preview pawukon)**

`web/src/routes/contacts.$id.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Channel, type Contact, type Settings } from '../lib/api'

export const Route = createFileRoute('/contacts/$id')({ component: ContactDetail })

const TIPE: { value: string; label: string }[] = [
  { value: 'otongan', label: 'Otonan (Pawukon 210 hari)' },
  { value: 'birthday', label: 'Ulang tahun' },
  { value: 'anniversary', label: 'Anniversary' },
]

function ContactDetail() {
  const { id } = Route.useParams()
  const qc = useQueryClient()
  const nav = useNavigate()
  const contact = useQuery({ queryKey: ['contact', id], queryFn: () => api<Contact>(`/contacts/${id}`) })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  const [type, setType] = useState('otongan')
  const [date, setDate] = useState('')
  const [pawukon, setPawukon] = useState('')
  const [offsets, setOffsets] = useState('')
  const [enabled, setEnabled] = useState(true)

  async function previewPawukon(d: string) {
    setPawukon('')
    if (!d || type !== 'otongan') return
    try { setPawukon((await api<{ label: string }>(`/pawukon?date=${d}`)).label) } catch { /* diam */ }
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }
  const addOcc = useMutation({
    mutationFn: () => api(`/contacts/${id}/occasions`, { method: 'POST', body: JSON.stringify({ type, date }) }),
    onSuccess: () => { setDate(''); setPawukon(''); invalidate() },
  })
  const delOcc = useMutation({
    mutationFn: (oid: number) => api(`/occasions/${oid}`, { method: 'DELETE' }), onSuccess: invalidate,
  })
  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/contacts/${id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  })
  const delContact = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => nav({ to: '/contacts' }),
  })

  if (contact.isLoading) return <p className="text-slate-500">Memuat…</p>
  if (contact.isError) return <p className="text-red-600">{String(contact.error)}</p>
  const c = contact.data!

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{c.name}</h1>
        <button onClick={() => { if (confirm(`Hapus ${c.name}?`)) delContact.mutate() }}
          className="text-sm text-red-600 hover:underline">Hapus kontak</button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Occasions</h2>
        {c.occasions.map((o) => (
          <div key={o.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
            <span>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs uppercase text-indigo-700">{o.type}</span>{' '}
              {o.base_date}
            </span>
            <button onClick={() => delOcc.mutate(o.id)} className="text-red-500 hover:underline">hapus</button>
          </div>
        ))}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {TIPE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="date" value={date}
            onChange={(e) => { setDate(e.target.value); previewPawukon(e.target.value) }}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          <button disabled={!date || addOcc.isPending} onClick={() => addOcc.mutate()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Tambah</button>
        </div>
        {pawukon && <p className="mt-2 text-sm text-emerald-700">🛕 {pawukon}</p>}
        {type === 'birthday' && date.endsWith('-02-29') && (
          <p className="mt-2 text-xs text-slate-500">29 Feb di tahun non-kabisat diperingati 1 Maret.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Preferensi Pengingat</h2>
        <p className="mb-2 text-sm text-slate-500">
          Default global: {(settings.data?.default_offsets ?? []).map((n) => `H-${n}`).join(', ')} · jam kirim {settings.data?.send_time}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={offsets} onChange={(e) => setOffsets(e.target.value)} placeholder="offset, mis. 7,4,2,1,0 (kosong = default)"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> aktif
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {channels.data?.channels.map((ch) => (
            <label key={ch.id} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-sm">
              <input type="checkbox"
                defaultChecked={c.prefs?.channel_ids.includes(ch.id) ?? false}
                onChange={(e) => {
                  const cur = new Set(c.prefs?.channel_ids ?? [])
                  e.target.checked ? cur.add(ch.id) : cur.delete(ch.id)
                  savePrefs.mutate({ channel_ids: [...cur] })
                }} />
              {ch.name} ({ch.type})
            </label>
          ))}
        </div>
        <button
          onClick={() => savePrefs.mutate({
            offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : undefined,
            enabled,
          })}
          className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
          Simpan preferensi
        </button>
        {savePrefs.isError && <p className="mt-2 text-sm text-red-600">{String(savePrefs.error)}</p>}
      </section>
    </div>
  )
}
```

Catatan untuk engineer: checkbox channel memakai `defaultChecked` + mutate langsung saat toggle (langsung tersimpan), field offsets/enabled memakai tombol Simpan. Perilaku ini disengaja — dua jalur tersimpan.

- [ ] **Step 3: Verifikasi + commit**

```bash
npm run build
```
Expected: sukses. Manual: tambah kontak → tambah occasion otongan → preview pawukon muncul → toggle channel tersimpan (refresh tetap).

```bash
git add web/ && git commit -m "feat(web): crud kontak, occasions, prefs dengan preview pawukon"
```

---

### Task 5: Channel — kelola + tombol tes

**Files:**
- Modify: `web/src/routes/channels.tsx`

- [ ] **Step 1: Implementasi**

`web/src/routes/channels.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Channel } from '../lib/api'

export const Route = createFileRoute('/channels')({ component: Channels })

const TIPE = ['gotify', 'telegram', 'email'] as const

const FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  gotify: [
    { key: 'base_url', label: 'Base URL Gotify' },
    { key: 'token', label: 'Token App' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token (dari @BotFather)' },
    { key: 'chat_id', label: 'Chat ID (user/grup)' },
  ],
  email: [
    { key: 'host', label: 'SMTP Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'from', label: 'Alamat pengirim' },
    { key: 'to', label: 'Kepada (pisah koma)' },
  ],
}

function Channels() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const [type, setType] = useState<(typeof TIPE)[number]>('gotify')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<Record<number, string>>({})

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })
  const create = useMutation({
    mutationFn: () => api('/channels', { method: 'POST', body: JSON.stringify({ type, name, config: cfg }) }),
    onSuccess: () => { setName(''); setCfg({}); invalidate() },
  })
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) =>
      api(`/channels/${v.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v.enabled }) }),
    onSuccess: invalidate,
  })
  const del = useMutation({
    mutationFn: (id: number) => api(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
  const test = useMutation({
    mutationFn: async (id: number) => {
      try { await api(`/channels/${id}/test`, { method: 'POST' }); return 'OK ✅' }
      catch (e) { return `GAGAL: ${String(e)}` }
    },
    onSuccess: (msg, id) => {
      setTestResult((prev) => ({ ...prev, [id]: msg }))
      setTimeout(() => setTestResult((prev) => ({ ...prev, [id]: '' })), 8000)
    },
  })

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Channel Notifikasi</h1>

      {q.data?.channels.map((ch) => (
        <div key={ch.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className={`h-2 w-2 rounded-full ${ch.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{ch.name} <span className="text-xs uppercase text-slate-400">{ch.type}</span></p>
            {testResult[ch.id] && <p className="text-sm text-slate-600">Tes: {testResult[ch.id]}</p>}
          </div>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={ch.enabled}
              onChange={(e) => toggle.mutate({ id: ch.id, enabled: e.target.checked })} /> aktif
          </label>
          <button onClick={() => test.mutate(ch.id)} disabled={test.isPending}
            className="rounded-lg border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50">Tes</button>
          <button onClick={() => { if (confirm(`Hapus channel ${ch.name}?`)) del.mutate(ch.id) }}
            className="text-sm text-red-600 hover:underline">hapus</button>
        </div>
      ))}

      <form className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"
        onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <h2 className="font-semibold">Tambah Channel</h2>
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setCfg({}) }}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {TIPE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama (mis. gotify-rumah)"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        {FIELDS[type].map((f) => (
          <input key={f.key} type={f.type ?? 'text'} required
            value={cfg[f.key] ?? ''}
            onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
            placeholder={f.label}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        ))}
        <button disabled={!name.trim() || create.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">Simpan</button>
        <p className="text-xs text-slate-400">Config disimpan terenkripsi (AES-256-GCM) — tidak bisa dilihat lagi setelah disimpan.</p>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Verifikasi + commit**

```bash
npm run build
```
Manual: tambah channel gotify palsu → tombol Tes → tampil "GAGAL: …" (HTTP gagal) — bukti jalur test-send hidup.

```bash
git add web/ && git commit -m "feat(web): kelola channel + tombol tes kirim"
```

---

### Task 6: Settings

**Files:**
- Modify: `web/src/routes/settings.tsx`

- [ ] **Step 1: Implementasi**

`web/src/routes/settings.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, type Settings } from '../lib/api'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

const KATEGORI = [
  { key: 'pawukon', label: 'Hari raya Pawukon (dihitung lokal)' },
  { key: 'saka', label: 'Hari raya Bali & Saka (API)' },
  { key: 'national', label: 'Libur nasional (API)' },
]

function SettingsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const [form, setForm] = useState<Settings | null>(null)

  useEffect(() => { if (q.data && !form) setForm(q.data) }, [q.data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api('/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  if (!form) return <p className="text-slate-500">Memuat…</p>
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Pengaturan</h1>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          Timezone
          <input value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}
            placeholder="Asia/Jakarta / Asia/Makassar"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">
          Jam kirim (HH:MM)
          <input value={form.send_time} onChange={(e) => set({ send_time: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">
          Catch-up window (jam) — pengingat yang terlewat karena perangkat mati
          <input type="number" value={form.catch_up_hours}
            onChange={(e) => set({ catch_up_hours: Number(e.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">
          Offset default (hari sebelum H, pisah koma)
          <input value={form.default_offsets.join(',')}
            onChange={(e) => set({ default_offsets: e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Kategori hari raya</legend>
          {KATEGORI.map((k) => (
            <label key={k.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.holiday_categories[k.key] ?? false}
                onChange={(e) => set({ holiday_categories: { ...form.holiday_categories, [k.key]: e.target.checked } })} />
              {k.label}
            </label>
          ))}
        </fieldset>
        <button onClick={() => save.mutate(form)} disabled={save.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
          Simpan
        </button>
        {save.isError && <p className="text-sm text-red-600">{String(save.error)}</p>}
        {save.isSuccess && <p className="text-sm text-emerald-600">Tersimpan.</p>}
      </div>

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

- [ ] **Step 2: Verifikasi + commit**

```bash
npm run build
git add web/ && git commit -m "feat(web): halaman pengaturan (offset, jam kirim, tz, kategori hari raya)"
```

---

### Task 7: PWA + embed ke binary Go + NoRoute fallback

**Files:**
- Create: `web/public/manifest.webmanifest`, `web/public/icon.svg`, `web/public/sw.js`
- Modify: `web/index.html`, `web/src/main.tsx`
- Create: `internal/api/spa.go`, `internal/api/webroot.go`, `internal/api/webroot/.gitkeep`
- Modify: `internal/api/server.go` (1 baris route NoRoute)
- Create: `Makefile`
- Modify: `.gitignore`
- Test: `internal/api/spa_test.go`

**Interfaces:**
- Produces: `GET /` melayani SPA embed; path tak dikenal → `index.html` (client routing); `/api/*` tak dikenal → 404 JSON; belum di-build → 503.

- [ ] **Step 1: PWA assets**

`web/public/manifest.webmanifest`:

```json
{
  "name": "otorem — pengingat otonan & ultah",
  "short_name": "otorem",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#4f46e5",
  "icons": [{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }]
}
```

`web/public/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#4f46e5"/>
  <text x="50" y="68" font-size="52" text-anchor="middle">🛕</text>
</svg>
```

`web/public/sw.js` (service worker minimal — cukup untuk installability, tanpa strategi caching agar data selalu segar):

```js
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
})
```

`web/index.html` — tambahkan di `<head>`:

```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#4f46e5" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
```

`web/src/main.tsx` — tambahkan di akhir file (sebelum baris terakhir `)`):

```tsx
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
```

- [ ] **Step 2: Embed + NoRoute**

`internal/api/webroot.go`:

```go
package api

import "embed"

//go:embed all:webroot
var webRoot embed.FS
```

`internal/api/webroot/.gitkeep` — file kosong (di-commit agar `go:embed` tidak gagal sebelum build pertama).

Tambahkan di `internal/api/server.go` — tepat setelah baris `r.GET("/metrics", ...)`:

```go
	r.NoRoute(s.spaHandler())
```

`internal/api/spa.go`:

```go
package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// spaHandler: layani file statis hasil `make web` (di-embed). Path tak dikenal
// → index.html (client-side routing). Belum di-build → 503 dengan pesan jelas.
func (s *Server) spaHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") || c.Request.URL.Path == "/metrics" {
			c.JSON(http.StatusNotFound, gin.H{"error": "endpoint tidak ditemukan"})
			return
		}
		rel := strings.TrimPrefix(path.Clean("/"+c.Request.URL.Path), "/")
		if rel == "" || rel == "." {
			rel = "index.html"
		}
		if _, err := fs.Stat(webRoot, "webroot/"+rel); err == nil {
			c.FileFromFS("webroot/"+rel, http.FS(webRoot))
			return
		}
		if _, err := fs.Stat(webRoot, "webroot/index.html"); err == nil {
			c.FileFromFS("webroot/index.html", http.FS(webRoot))
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SPA belum di-build — jalankan 'make web'"})
	}
}
```

`internal/api/spa_test.go`:

```go
package api

import (
	"net/http/httptest"
	"testing"
)

func TestSPANotBuiltReturns503(t *testing.T) {
	s := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 { t.Errorf("/ tanpa build webroot: %d, want 503", w.Code) }
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/tidak-ada", nil))
	if w.Code != 404 { t.Errorf("/api/* tidak dikenal: %d, want 404", w.Code) }
}
```

- [ ] **Step 3: Makefile + gitignore**

`Makefile`:

```make
.PHONY: test web build run docker

test:
	CGO_ENABLED=0 go test ./... -count=1

web:
	cd web && npm ci && npm run build
	rm -rf internal/api/webroot && mkdir -p internal/api/webroot
	cp -R web/dist/. internal/api/webroot/

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/otorem ./cmd/server

run: build
	APP_SECRET=dev-secret-panjang-16 AUTH_MODE=dev DATA_DIR=./data ./bin/otorem

docker:
	docker compose build
```

`.gitignore` (di root repo):

```
bin/
data/
web/node_modules/
web/dist/
web/routeTree.gen.bak
internal/api/webroot/*
!internal/api/webroot/.gitkeep
.env
```
(catatan: `web/routeTree.gen.ts` adalah hasil generate plugin — di-commit agar build konsisten; kalau konflik saat merge, regenerate dengan `npm run build`.)

- [ ] **Step 4: Verifikasi end-to-end embed**

```bash
make build
APP_SECRET=dev-secret-panjang-16 AUTH_MODE=dev DATA_DIR=/tmp/otoremdata ./bin/otorem &
sleep 1
curl -s localhost:8080/ | head -c 200; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/contacts/1
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/v1/tidak-ada
pkill -f bin/otorem || true
go test ./internal/api/ -v -run TestSPA
```
Expected: `/` → HTML berisi `<div id="root">`; `/contacts/1` → 200 index.html (SPA fallback); `/api/v1/tidak-ada` → 404 JSON.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web+api): pwa manifest, embed spa via go:embed, noroute fallback + makefile"
```

---

### Task 8: Docker + compose + README + verifikasi final

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy/litestream.yml`, `README.md`

- [ ] **Step 1: Dockerfile multi-stage**

`Dockerfile`:

```dockerfile
# ---- 1: build SPA ----
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2: build binary (embed SPA) ----
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=web /src/web/dist internal/api/webroot
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/otorem ./cmd/server

# ---- 3: image final ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget
COPY --from=build /out/otorem /usr/local/bin/otorem
ENV ADDR=:8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["otorem"]
```

- [ ] **Step 2: Compose + env + litestream**

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/data
    networks: [internal]

  cloudflared:
    image: cloudflare/cloudflared:latest
    profiles: [cloudflared]
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on: [app]
    networks: [internal]

  gotify:
    image: gotify/server:latest
    profiles: [gotify]
    restart: unless-stopped
    volumes:
      - ./gotify-data:/app/data
    networks: [internal]

  litestream:
    image: litestream/litestream:latest
    profiles: [litestream]
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./deploy/litestream.yml:/etc/litestream.yml:ro
    depends_on: [app]
    networks: [internal]

networks:
  internal: {}
```

`.env.example`:

```bash
# Wajib — kunci enkripsi config channel (AES-256-GCM). Minimal 16 karakter.
APP_SECRET=ganti-dengan-string-acak-panjang

# Auth — isi dari Cloudflare Zero Trust (lihat README §Cloudflare Access)
AUTH_MODE=cfaccess
CF_ACCESS_TEAM_DOMAIN=team-anda.cloudflareaccess.com
CF_ACCESS_AUD=xxxxxxxxxxxxxxxxxxxxxxxxxx
ADMIN_EMAILS=email@anda.com

# Umum
TZ=Asia/Makassar
DATA_DIR=/data
ADDR=:8080

# Hanya untuk profile cloudflared
TUNNEL_TOKEN=
```

`deploy/litestream.yml`:

```yaml
# Replikasi SQLite ke object storage — isi sesuai penyedia (S3/R2).
dbs:
  - path: /data/otorem.db
    replicas:
      - url: s3://bucket-anda/otorem/otorem.db
        # endpoint, access-key-id, secret-access-key via env LITESTREAM_*
```

- [ ] **Step 3: README.md**

Isi README (tulis lengkap, struktur wajib):
1. **Judul + deskripsi 2 kalimat** — pengingat otonan Bali (Pawukon 210 hari), ultah, anniversary, hari raya; notifikasi Gotify/Telegram/Email; self-hosted 1 container.
2. **Fitur** — bullet list dari spec (offset customizable per kontak, dedupe + catch-up, hari raya, PWA).
3. **Quickstart**:
   ```bash
   cp .env.example .env   # edit APP_SECRET, CF_ACCESS_*, ADMIN_EMAILS
   docker compose --profile cloudflared up -d --build
   ```
4. **Cloudflare Access setup**: Zero Trust → Access → Applications → Add self-hosted → domain `otorem.domain-anda.com` → policy email; catat **team domain** (`xxx.cloudflareaccess.com`) dan **AUD** (Application Audience) → isi `.env`; tunnel: Zero Trust → Networks → Tunnels → Create → salin TUNNEL_TOKEN.
5. **Dev mode** (tanpa tunnel): `AUTH_MODE=dev`, buka app, masukkan email saat prompt; header `X-Dev-Email`.
6. **Notifikasi**: Gotify (create app di UI gotify → salin token), Telegram (@BotFather → token; chat_id via getUpdates), Email (Gmail app-password atau SMTP relay transaksional — kirim dari IP rumah rawan spam).
7. **Backup & restore**: volume `./data` (file SQLite WAL) + opsi litestream (`docker compose --profile litestream up -d`); restore: stop app → `litestream restore -o /data/otorem.db s3://…` → start.
8. **Pengembangan**: `make test`, `make web`, `make run` (dev mode di :8080), scraper fixture `go run ./scripts/fetch_fixtures -year 2026` (data © kalenderbali.org — fixture pribadi, jangan dire distribusikan).
9. **Struktur proyek** — pohon singkat sesuai spec §3.

- [ ] **Step 4: Verifikasi final (semua harus hijau)**

```bash
CGO_ENABLED=0 go test ./... -count=1        # semua test hijau
docker compose config                        # valid, tanpa error
docker compose build app                     # image terbangun
docker run --rm -d --name otorem-smoke -p 8081:8080 \
  -e APP_SECRET=dev-secret-panjang-16 -e AUTH_MODE=dev otorem-app:latest
sleep 2
curl -s localhost:8081/healthz
curl -s localhost:8081/ | head -c 120        # HTML SPA dari embed
curl -s -H 'X-Dev-Email: a@b.c' -X POST localhost:8081/api/v1/scheduler/run
docker rm -f otorem-smoke
```
Expected: `{"ok":true}`; HTML `<!doctype html>`/`<div id="root">`; JSON counts dari scheduler-run.

- [ ] **Step 5: Commit final + tag**

```bash
git add -A
git commit -m "feat(deploy): dockerfile multi-stage, compose profiles, readme operasional"
git tag plan-4-spa-deploy-done
```

---

## Definition of Done (Plan 4 — sekaligus proyek otorem v1)

- [ ] `CGO_ENABLED=0 go test ./... -count=1` hijau penuh.
- [ ] `make build` menghasilkan satu binary berisi SPA; `/` menyajikan UI; deep-link `/contacts/1` → 200.
- [ ] `docker compose config` valid; `docker compose build app` sukses; smoke container healthz + SPA + scheduler-run OK.
- [ ] PWA installable dari HP (manifest + SW).
- [ ] README memuat setup Cloudflare Access, notifikasi, backup.
- [ ] Tag `plan-4-spa-deploy-done`.

**Catatan eksekusi lintas-plan:** setelah tag terakhir, urutan verifikasi manual yang disarankan (device lokal + tunnel): buat kontak + otonan dengan base = hari-ini−210 → `POST /scheduler/run` → pesan masuk ke channel uji (Gotify lokal) → matikan container 1 jam → nyalakan → run lagi → reminder terlewat terkirim berlabel "terlambat". Gagal di tahap mana pun = kembali ke plan terkait (1: tanggal, 2: API, 3: kirim, 4: paket).
