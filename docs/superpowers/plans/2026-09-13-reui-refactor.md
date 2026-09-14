# Refactoring otorem's UI to reUI + App Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the entire `web/` UI of otorem to use reUI components (shadcn fallback), plus an app shell sidebar (the "Autoreminder" launcher) with a horizontal navbar in the content header.

**Architecture:** The primitive foundation is installed first via reUI `c-*` examples (the `@reui` registry, `base-nova`/Base UI style), then the shadcn sidebar app shell is ported to Vite + TanStack Router + Tailwind v4, then each page is refactored one by one inside the shell. react-query/route logic is unchanged except for adding toasts in mutation callbacks.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, TanStack Router/Query, shadcn CLI (`@reui` registry + the official shadcn registry for the `sidebar` block), sonner, Base UI (`@base-ui/react`), lucide-react, date-fns.

**Spec:** `docs/superpowers/specs/2026-09-13-reui-refactor-design.md`

## Global Constraints

- All frontend commands run from `web/`.
- Component source rule: **reUI first, shadcn if reUI has none**.
- CLI strategy: `npx shadcn add …` (4.21); if that fails/registry error → `npx shadcn@3.8.5 add …` (proven in `web/SHADCN.md`).
- **There is no frontend test runner in this project** (no vitest/jest). Each task's gate = green `npm run build` (tsc + vite) + clean `npm run lint` (oxlint) + visual browser verification (`npm run dev` dev server + the browser-use skill) + a `git status` free of unexpected changes. This replaces the TDD cycle for this project — do not add a test framework.
- Do not touch: `src/components/reui/event-calendar/**`, the Go backend, other users' WIP files (`src/index.css` only when a step says so).
- Repo commit style: conventional commit + Indonesian description, e.g. `feat(web): …`.
- Existing Base UI primitives used by this plan (do not rewrite them):
  - `Button` variants `default | outline | secondary | ghost | destructive | link`, sizes `default | xs | sm | lg | icon | icon-sm | …` (`ui/button.tsx`).
  - `Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem` — Base UI props: `value`, `onValueChange` (`ui/select.tsx`).
  - `Switch` — Base UI props: `checked`, `onCheckedChange`, size `sm|default` (`ui/switch.tsx`).
  - `Calendar` (react-day-picker, `mode="single"`, props `selected`/`onSelect`) (`ui/calendar.tsx`).
  - `Popover, PopoverTrigger, PopoverContent`, `Field, FieldLabel, FieldDescription`, `Separator`, `Input`, `Label`, `Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter` (`ui/*`).
- Components produced by the installs (standard base-nova filenames/APIs): `ui/alert*`, `ui/badge`, `ui/checkbox`, `ui/sonner`, `ui/avatar`, `ui/sidebar`, `ui/sheet`, `ui/skeleton`. If a generated sub-component name differs slightly from what the task code uses, **follow the installed file** (do not change the primitive).
- After every registry install: run `git -C … status --porcelain -- web/` and make sure only component/lockfile files changed; any unexpectedly modified file → `git checkout -- <file>`.

---

### Task 1: Branch + reUI primitive foundation + Toaster

**Files:**
- Create (via CLI): `src/components/ui/alert.tsx`, `src/components/ui/alert-dialog.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/checkbox.tsx`, `src/components/ui/sonner.tsx`, `src/components/ui/avatar.tsx`
- Create (via CLI): `src/components/examples/c-alert-1.tsx`, `c-alert-dialog-1.tsx`, `c-badge-1.tsx`, `c-checkbox-1.tsx`, `c-sonner-1.tsx`, `c-avatar-1.tsx`
- Modify: `src/routes/__root.tsx` (mount `<Toaster />` temporarily — Task 4 rewrites it completely)

**Interfaces:**
- Produces: `Alert, AlertTitle, AlertDescription`, `AlertDialog*`, `Badge` (standard variants), `Checkbox` (Base UI: `checked`, `onCheckedChange`), `Avatar, AvatarImage, AvatarFallback`, `Toaster` — used by Tasks 5–9.

- [ ] **Step 1: Create the work branch**

```bash
git -C /Users/taksu/Work/code/otorem checkout -b feature/reui-refactor
```

- [ ] **Step 2: Install the six foundation examples from the @reui registry**

```bash
cd /Users/taksu/Work/code/otorem/web
npx shadcn add @reui/c-alert-1 @reui/c-alert-dialog-1 @reui/c-badge-1 @reui/c-checkbox-1 @reui/c-sonner-1 @reui/c-avatar-1
```

If there is a registry/schema error → rerun per item with `npx shadcn@3.8.5 add @reui/c-<name>-1`. Verify the generated files exist in `src/components/ui/` (alert, alert-dialog, badge, checkbox, sonner, avatar). If a primitive was NOT installed along with an example (the example did not declare the dependency), install the primitive directly from the official registry: `npx shadcn add alert` (or `badge`/`checkbox`/`sonner`/`avatar`/`alert-dialog`).

- [ ] **Step 3: Check `ui/sonner.tsx` — drop any Next.js dependency**

If the installed file imports `next-themes` (the Next template), replace the whole content with:

```tsx
import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster({ ...props }: ToasterProps) {
  return <Sonner position="top-right" {...props} />
}

export { Toaster }
```

(The `sonner` package is definitely installed by the CLI; if not: `npm install sonner`.)

- [ ] **Step 4: Mount the Toaster at the root**

`src/routes/__root.tsx` — add the import and wrap the layout:

```tsx
import { Toaster } from '@/components/ui/sonner'
// inside the root component, before <Outlet />:
<Toaster />
```

- [ ] **Step 5: Green build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: `✓ built in …` with no TS errors; oxlint with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components src/routes/__root.tsx package.json package-lock.json
git commit -m "feat(web): fondasi primitif reui — alert, alert-dialog, badge, checkbox, sonner, avatar"
```

---

### Task 2: shadcn sidebar block + Tailwind v4 / TanStack port

**Files:**
- Create (via CLI): `src/components/ui/sidebar.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/skeleton.tsx`
- Create (if the CLI does not add it): `src/hooks/use-mobile.ts`
- Modify: `src/components/ui/sidebar.tsx` (port)

**Interfaces:**
- Produces: `SidebarProvider, Sidebar, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar` — used by Tasks 3–4. `Skeleton` is used by Task 9.

- [ ] **Step 1: Install the sidebar block**

```bash
cd /Users/taksu/Work/code/otorem/web
npx shadcn add sidebar
```

(This block comes from the official shadcn registry; it also creates its dependencies `ui/sheet.tsx` + `ui/skeleton.tsx`.)

- [ ] **Step 2: Make sure the mobile hook is available**

`grep -n "use-mobile\|useMediaQuery\|useIsMobile" src/components/ui/sidebar.tsx`. If it imports `@/hooks/use-mobile` and that file does not exist, create `src/hooks/use-mobile.ts`:

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

- [ ] **Step 3: Port sidebar.tsx to the project stack**

In `src/components/ui/sidebar.tsx`:

1. Remove `'use client'` and any `usePathname` import from `next/navigation`. Replace its usage (the close-sheet-on-navigation effect) with TanStack Router:

```tsx
import { useRouterState } from '@tanstack/react-router'
// inside function Sidebar(...) :
const pathname = useRouterState({ select: (s) => s.location.pathname })
React.useEffect(() => { setOpenMobile(false) }, [pathname, setOpenMobile])
```

2. Replace all remaining Tailwind v3 CSS-variable syntax: `w-[--sidebar-width]` → `w-(--sidebar-width)`, `w-[--sidebar-width-icon]` → `w-(--sidebar-width-icon)`, `max-w-[--skeleton-width]` → `max-w-(--skeleton-width)`, and `w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]` → `w-[calc(var(--sidebar-width-icon)+var(--spacing)*4)]` (with all its variants on the `floating|inset` lines).
3. If any `hsl(var(--sidebar-…))` class remains, change it to `var(--sidebar-…)` (the project tokens are full oklch).

- [ ] **Step 4: Green build**

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in …` (the sidebar is not used by any route yet; tsc must still pass).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui src/hooks package.json package-lock.json
git commit -m "feat(web): block sidebar shadcn + porting tailwind v4 & tanstack router"
```

---

### Task 3: AppSidebar (logo + data-driven menu)

**Files:**
- Create: `web/public/logo-w.svg` (copy from `/Users/taksu/.openclaw-autoclaw/agents/auto-designer/workspace/logo-w.svg`)
- Create: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `Sidebar*` from Task 2.
- Produces: `AppSidebar` (used by Task 4), `SIDEBAR_MODULES` (an array of `{ to: string; label: string }`) as the data-driven menu configuration.

- [ ] **Step 1: Copy the logo**

```bash
cp /Users/taksu/.openclaw-autoclaw/agents/auto-designer/workspace/logo-w.svg /Users/taksu/Work/code/otorem/web/public/logo-w.svg
```

- [ ] **Step 2: Write AppSidebar**

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

/** Data-driven sidebar menu — new self-app modules (notes, habits, etc.) just
 *  add an entry here (spec: the memory-app vision). */
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

- [ ] **Step 3: Green build**

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in …`

- [ ] **Step 4: Commit**

```bash
git add public/logo-w.svg src/components/app-sidebar.tsx
git commit -m "feat(web): appsidebar — logo otorem + menu data-driven"
```

---

### Task 4: __root as the shell (sidebar + horizontal navbar)

**Files:**
- Modify (rewrite): `src/routes/__root.tsx`

**Interfaces:**
- Consumes: `AppSidebar`, `SidebarProvider/SidebarInset/SidebarTrigger` (Tasks 2–3), `Toaster` (Task 1).
- Produces: the layout shell for all routes; a 4-link navbar with active state.

- [ ] **Step 1: Rewrite __root.tsx**

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

Note: if `Separator` from `@base-ui/react/separator` is not exported in the installed version, use `import { Separator } from '@/components/ui/separator'` (the project primitive).

- [ ] **Step 2: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: both green.

- [ ] **Step 3: Visual shell verification**

Run: `npm run dev` (in the background; note the port — 5173 may be taken, check the output).
Browser (browser-use skill): open `http://localhost:<port>/`.
- The sidebar shows: logo + "otorem" name + the "Autoreminder" menu active at `/`.
- Horizontal navbar: "Dashboard" is bold at `/`; click "Kontak" → Kontak becomes bold, Dashboard does not.
- Toggle the sidebar (click the trigger): collapses to an icon rail; `Ctrl/Cmd+B` also works.
- Narrow the viewport below 768px: the sidebar becomes a Sheet (the trigger opens a slide-in panel).
- Console has no errors.
Close the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat(web): app shell — sidebar launcher + navbar horizontal"
```

---

### Task 5: Settings phase (pilot)

**Files:**
- Modify (rewrite): `src/routes/settings.tsx`

**Interfaces:**
- Consumes: `Select*`, `Checkbox`, `Button`, `Card*`, `Field*`, `Input`, `Toaster` (already mounted, use `toast` from `sonner`).

- [ ] **Step 1: Rewrite settings.tsx**

Replace the entire content of `src/routes/settings.tsx` (the constants `KATEGORI`, `TZ_INDONESIA`, `TZ_LAINNYA`, `gmtOffset`, `tzOptionText` are left exactly as they are now — do not change them):

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

// … KATEGORI, TZ_INDONESIA, TZ_LAINNYA, gmtOffset, tzOptionText: STAY as in the old file …

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
                {/* a stored value that is not in the list is still shown */}
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
Expected: green. (If `onValueChange` has a different signature in base-nova — check `ui/select.tsx`/its types and adjust.)

- [ ] **Step 3: Visual verification**

Dev server + browser → `/settings`: the timezone select opens with Indonesia/other groups; checkboxes toggle; change something → Simpan → a "Tersimpan." toast appears in the top right; console is clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "feat(web): refactor settings ke primitif ui + toast"
```

---

### Task 6: Channels phase

**Files:**
- Modify (rewrite): `src/routes/channels.tsx`

**Interfaces:**
- Consumes: the Task 1–2 primitives + `Switch`, `AlertDialog*`, `Badge`, `Input`.

- [ ] **Step 1: Rewrite channels.tsx**

The `TIPE`, `FIELDS` constants stay the same. The `testResult` state is **removed** (test results go through a toast). The `test` mutation is simplified:

```tsx
const test = useMutation({
  mutationFn: (id: number) => api(`/channels/${id}/test`, { method: 'POST' }),
  onSuccess: () => toast.success('Tes berhasil — notifikasi terkirim.'),
  onError: (e) => toast.error(`Tes gagal: ${String(e)}`),
})
```

The channel list JSX (replacing the old `q.data?.channels.map(...)` block):

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

The "Tambah Channel" form: wrap it in `Card` (+`CardHeader`/`CardTitle`), change the native select → `Select`+`SelectTrigger`+`SelectContent`+`SelectItem` (value `type`, `onValueChange={(v) => { setType(v as typeof type); setCfg({}) }}`), all native `<input>` → `Input` (`type` follows `f.type`, password stays `type="password"`), the Simpan button → `<Button type="submit" disabled={!name.trim() || create.isPending}>Simpan</Button>`, and the encryption info paragraph → `Alert`:

```tsx
<Alert>
  <AlertTitle>Config disimpan terenkripsi (AES-256-GCM)</AlertTitle>
  <AlertDescription>Tidak bisa dilihat lagi setelah disimpan.</AlertDescription>
</Alert>
```

Add `import { toast } from 'sonner'` and remove unused imports.

- [ ] **Step 2: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: green.

- [ ] **Step 3: Visual verification**

`/channels`: the Switch toggles active/inactive (badge & text follow), the Tes button shows a success/failure toast, Hapus opens the AlertDialog (Batal does not delete, Hapus deletes), the add form with the type select works.

- [ ] **Step 4: Commit**

```bash
git add src/routes/channels.tsx
git commit -m "feat(web): refactor channels — switch, alert-dialog, toast"
```

---

### Task 7: Contacts phase (list + detail)

**Files:**
- Modify (rewrite): `src/routes/contacts.index.tsx`
- Modify (rewrite): `src/routes/contacts.$id.tsx`

**Interfaces:**
- Consumes: the Task 1–2 primitives + `Avatar, AvatarFallback`, `Badge`, `Calendar`, `Popover*`, `Switch`, `AlertDialog*`. `format` from `date-fns` (already present).

- [ ] **Step 1: Rewrite contacts.index.tsx**

The form stays (native input → `Input`, button → `Button`). A contact row becomes a Card + initials Avatar:

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

- [ ] **Step 2: Rewrite contacts.$id.tsx**

The mutation/query logic (`previewPawukon`, `addOcc`, `delOcc`, `savePrefs`, `delContact`, `hydratePrefsForm`) **stays the same**. Presentational changes:

1. Sections → `Card`+`CardHeader`+`CardTitle`+`CardContent` (two sections: Occasions, Preferensi Pengingat).
2. The occasion type chip → `<Badge variant="secondary" className="uppercase">{o.type}</Badge>`.
3. The native type select → `Select`+`SelectItem` from `TIPE`.
4. The native `<input type="date">` → a Popover + Calendar date picker:

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

(import `CalendarIcon` from lucide, `format` from date-fns, `Calendar` from `@/components/ui/calendar`.)

5. The "aktif" checkbox (preferences) → `Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)}`; the per-channel checkbox STAYS a `Checkbox` (multi-select) with the same Set logic in `onCheckedChange`.
6. The delete-contact & delete-occasion buttons → `AlertDialog` (exactly the Task 6 pattern; for an occasion without a long title: title `Hapus occasion ini?`).
7. Action buttons → `Button` (Tambah = default, Simpan preferensi = default, cancel = outline).
8. Feedback: `{savePrefs.isError && …}` → `toast.error` in the `savePrefs` mutation `onError` (add onError; onSuccess still calls `invalidate()`).

- [ ] **Step 3: Build + lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Expected: green.

- [ ] **Step 4: Visual verification**

`/contacts`: add a contact, a card appears with the initials avatar. Open the detail: pick a date via the calendar popover → the pawukon preview appears for the otonan type; add an occasion → the list grows with a type badge; toggle active + save preferences → no errors; delete an occasion & delete the contact via AlertDialog (deleting the contact returns to the list).

- [ ] **Step 5: Commit**

```bash
git add src/routes/contacts.index.tsx src/routes/contacts.\$id.tsx
git commit -m "feat(web): refactor contacts — card, avatar, date picker, alert-dialog"
```

---

### Task 8: Dashboard polish phase

**Files:**
- Modify: `src/routes/index.tsx` (the EventCalendar calendar & nav are **not touched**)

**Interfaces:**
- Consumes: `Alert*`, `Badge`, `Skeleton`, `Card` (Tasks 1–2).

- [ ] **Step 1: Replace the empty-channel banner with an Alert**

The `{channels.data && channels.data.channels.length === 0 && (…)}` block:

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

- [ ] **Step 3: Upcoming cards → Card + Badge**

Replace the `badgeClass` circle + manual card. The new urgency function (theme tokens):

```tsx
function urgencyClass(days: number): string {
  if (days <= 0) return 'bg-destructive text-destructive-foreground'
  if (days <= 3) return 'bg-warning text-warning-foreground'
  if (days <= 7) return 'bg-amber-400 text-amber-950'
  return 'bg-muted text-muted-foreground'
}
```

The item row:

```tsx
<Card key={…} className="flex-row items-center gap-3 p-3">
  <Badge className={`h-11 w-11 rounded-full text-xs font-bold ${urgencyClass(it.days_until)}`}>
    {it.days_until <= 0 ? 'HARI H' : `H-${it.days_until}`}
  </Badge>
  <div className="min-w-0 flex-1"> …old content… </div>
  <div className="hidden shrink-0 gap-1 sm:flex">
    {it.reminders?.map((r) => (
      <Badge key={r} variant="secondary">H-{r}</Badge>
    ))}
  </div>
</Card>
```

Remove the old `badgeClass` function. Import `Alert, AlertTitle, AlertDescription`, `Badge`, `Card`, `Skeleton`.

- [ ] **Step 4: Build + lint + visual verification**

Run: `npm run build 2>&1 | tail -3 && npm run lint`
Browser `/`: the event-calendar is unchanged; the Alert banner appears only when there are no channels; the upcoming list shows H-x badges with graded colors; the skeleton is visible on reload with a slow network (throttle).

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(web): dashboard polish — alert, badge, skeleton"
```

---

### Task 9: Cleanup + final sweep

**Files:**
- Modify: `web/SHADCN.md` (sidebar install note)
- Sweep all routes

- [ ] **Step 1: Make sure no native elements remain**

```bash
grep -rn "confirm(" src/routes/ ; grep -rn "<select" src/routes/ ; grep -rn 'type="checkbox"' src/routes/
```

Expected: no results. If any remain → refactor them with the appropriate task pattern.

- [ ] **Step 2: Lint + production build**

Run: `npm run lint && npm run build 2>&1 | tail -3`
Expected: both green.

- [ ] **Step 3: Full visual verification**

Dev server + browser: visit `/`, `/contacts`, `/contacts/1`, `/channels`, `/settings` — the shell is consistent (sidebar + navbar), no broken layouts, a clean console on every page. Close the dev server.

- [ ] **Step 4: Record the decision in SHADCN.md**

Append to `web/SHADCN.md`:

```
- The sidebar (shell) is installed from the official shadcn registry (`npx shadcn add sidebar`) — reUI has no sidebar family; it is ported to TanStack Router (`useRouterState` instead of `usePathname`) and Tailwind v4 (`w-(--sidebar-width)`), and the `--color-sidebar*` tokens are already available in base-nova.
```

- [ ] **Step 5: Commit**

```bash
git add SHADCN.md src/routes
git commit -m "chore(web): perapian pasca refactor + catatan sidebar"
```

---

## Self-Review (already performed by the plan author)

1. **Spec coverage**: Phase 0 → Task 1; shell → Tasks 2–4; Settings → Task 5; Channels → Task 6; Contacts → Task 7; Dashboard → Task 8; cleanup → Task 9; logo & NAV_CONFIG → Task 3; data-driven vision → `SIDEBAR_MODULES` in Task 3. No spec section is left without a task.
2. **Placeholders**: unchanged constants/settings are given an explicit "STAY as in the old file" instruction with the same file context in the repo — not a new logic placeholder.
3. **Type consistency**: `SIDEBAR_MODULES`/`AppSidebar` (Task 3) are used by Task 4; `Toaster` (Task 1) is used by Task 4; `Skeleton` (Task 2) is used by Task 8; all Base UI props (`onCheckedChange`, `onValueChange`) are consistent with the Global Constraints note.
