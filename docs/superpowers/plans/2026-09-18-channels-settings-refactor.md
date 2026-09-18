# Channels & Settings Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `reminder.channels.tsx` and `reminder.settings.tsx` into self-contained domain components (contacts-page architecture) and close the UX gaps (skeletons, error/empty states, header pattern), preserving all behavior.

**Architecture:** Components own their queries/mutations; route files only compose (like `ContactDetailPageContent` / `ContactEditForm`). New `components/channels/` and `components/settings/` directories. Spec: `docs/superpowers/specs/2026-09-18-channels-settings-refactor-design.md`.

**Tech Stack:** React 19, TanStack Router (file routes), TanStack Query v5, shadcn-style UI in `components/ui/`, Tailwind v4, pnpm, TypeScript.

## Global Constraints

- **No web test runner exists** (no vitest/jest in `web/package.json`). Do NOT add one. Per-task verification = `pnpm build` (runs `tsc -b && vite build`) + `pnpm lint` (oxlint) in `web/`; final manual pass is Task 3.
- Package manager is pnpm; run web commands from `web/` (`cd web && pnpm …`).
- Behavior preservation (spec checklist): default-channel semantics, active toggle, test toasts, delete confirmation copy, holiday categories + reset-to-default, recurrence validation gating Save, encryption notice, timezone grouped select with stored-value fallback, signed-in footer, `pageTitle` head metadata.
- Three deliberate deltas, all spec'd: (1) add-channel dialog closes after successful create; (2) settings has ONE Save button (after the Recurrence card); (3) channel create shows `toast.success('Channel created')` (matches `ContactEditForm`'s create toast; flagged to user).
- The Checkbox/Switch rows must be wrapped in `<span>`, never `<label>` (double-fire fix, commit de7011d). Keep the existing explanatory comments when moving that code.
- Components import via `@/` alias; route files import lib via relative paths (`../lib/...`) and components via `@/components/...` (existing convention, see `reminder.contacts.index.tsx`).
- Route `head` metadata unchanged: `pageTitle('Channels')`, `pageTitle('Settings')`.
- The working tree has unrelated dirty files (CI/Docker/Go). Never stage them; stage only files this plan touches.
- API types (from `web/src/lib/api.ts`): `Channel { id, type, name, enabled }`; `Settings { timezone, send_time, catch_up_hours, default_offsets, default_channel_ids: string[] | null, holiday_categories, holiday_offsets, recurrence_offsets }`.

---

### Task 1: Settings domain components + thin settings route

**Files:**
- Create: `web/src/components/settings/timezone-select.tsx`
- Create: `web/src/components/settings/settings-page-content.tsx`
- Modify: `web/src/routes/reminder.settings.tsx` (full rewrite, 316 → ~20 lines)

**Interfaces:**
- Consumes: `api`, `type Settings` from `@/lib/api`; `parseList` from `@/lib/prefs`; UI primitives `Button`, `Card`, `Checkbox`, `Field`/`FieldLabel`/`FieldDescription`, `Input`, `Select*`, `Skeleton`.
- Produces: `TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void })` and `SettingsPageContent()` (no props). Task 1's route consumes both.

- [ ] **Step 1: Create `web/src/components/settings/timezone-select.tsx`**

```tsx
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Indonesian time zones — WIB/WITA/WIT labels are shown in the option. */
const TZ_INDONESIA = [
  { value: 'Asia/Jakarta', name: 'WIB' },
  { value: 'Asia/Makassar', name: 'WITA' },
  { value: 'Asia/Jayapura', name: 'WIT' },
]

/** Other common zones (diaspora/travel); more can be added — the backend accepts
 *  any valid IANA name via time.LoadLocation. */
const TZ_LAINNYA = [
  'UTC',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
]

/** "GMT+8" for a zone — computed from the current date so it follows
 *  DST (e.g. Sydney shifts to GMT+11 in summer). '' when unsupported. */
function gmtOffset(tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((x) => x.type === 'timeZoneName')
    const v = p?.value ?? ''
    if (!v.startsWith('GMT')) return ''
    return v === 'GMT' ? 'GMT+0' : v
  } catch {
    return ''
  }
}

function tzOptionText(tz: string, name?: string): string {
  const off = gmtOffset(tz)
  const suffix = [off, name].filter(Boolean).join(' · ')
  return suffix ? `${tz} (${suffix})` : tz
}

/** Grouped timezone Select (Indonesia / other) with GMT-offset suffixes. */
export function TimezoneSelect({ value, onChange }: {
  value: string
  onChange: (tz: string) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => { if (v) onChange(v) }}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent>
        {/* a stored value not in the list is still shown */}
        {!TZ_INDONESIA.some((t) => t.value === value) &&
          !TZ_LAINNYA.includes(value) && (
          <SelectItem value={value}>{tzOptionText(value)} — stored value</SelectItem>
        )}
        <SelectGroup>
          <SelectLabel>Indonesia</SelectLabel>
          {TZ_INDONESIA.map((t) => (
            <SelectItem key={t.value} value={t.value}>{tzOptionText(t.value, t.name)}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Other timezones</SelectLabel>
          {TZ_LAINNYA.map((tz) => (
            <SelectItem key={tz} value={tz}>{tzOptionText(tz)}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 2: Create `web/src/components/settings/settings-page-content.tsx`**

Port of the current `SettingsPage` body (queries, all text state, `saveNow`) with: skeleton replaces `Loading…`; the h1 stays in the route so the error return loses it; the two Save buttons become one, rendered after the Recurrence card; the timezone Select is replaced by `<TimezoneSelect>`.

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Settings } from '@/lib/api'
import { parseList } from '@/lib/prefs'
import { TimezoneSelect } from '@/components/settings/timezone-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const KATEGORI = [
  { key: 'pawukon', label: 'Pawukon holidays (computed locally)' },
  { key: 'saka', label: 'Balinese & Saka holidays (API)' },
  { key: 'national', label: 'National holidays (API)' },
]

/** Per-stream fallback offsets. Every stream needs a non-empty list — the
 *  backend rejects an empty one (it would make the fallback meaningless). */
const RECURRENCE_STREAMS = [
  { key: 'event', label: 'Event (base date)', placeholder: '30,7,4,2,1,0' },
  { key: 'yearly', label: 'Yearly marks', placeholder: '30,7,4,2,1,0' },
  { key: 'monthly', label: 'Monthly marks', placeholder: '0' },
  { key: 'otonan', label: 'Otonan marks', placeholder: '7,4,2,1,0' },
]

/** The settings form — both cards, one Save. Owns the settings/me queries,
 *  the text-field state, and the PUT; the route only supplies the title. */
export function SettingsPageContent() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const [form, setForm] = useState<Settings | null>(null)
  const [offsetsText, setOffsetsText] = useState('')
  const [holidayOffsetTexts, setHolidayOffsetTexts] = useState<Record<string, string>>({})
  const [recurrenceTexts, setRecurrenceTexts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (q.data && !form) {
      setForm(q.data)
      setOffsetsText(q.data.default_offsets.join(','))
      const texts: Record<string, string> = {}
      for (const k of KATEGORI) {
        const offs = q.data.holiday_offsets?.[k.key]
        if (offs?.length) texts[k.key] = offs.join(',')
      }
      setHolidayOffsetTexts(texts)
      // The GET always carries all four streams (stored blob or defaults).
      setRecurrenceTexts(
        Object.fromEntries(
          RECURRENCE_STREAMS.map((s) => [s.key, (q.data!.recurrence_offsets?.[s.key] ?? []).join(',')]),
        ),
      )
    }
  }, [q.data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api('/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error(`Failed to save: ${String(e)}`),
  })

  if (!form && q.isError)
    return (
      <p className="text-sm text-red-600">
        Failed to load settings: {String(q.error)} — check your login/dev email, then reload the page.
      </p>
    )
  if (!form)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[430px] w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })
  const recurrenceOffsets: Record<string, number[]> = Object.fromEntries(
    RECURRENCE_STREAMS.map((s) => [s.key, parseList(recurrenceTexts[s.key] ?? '')]),
  )
  const recurrenceOffsetsValid = RECURRENCE_STREAMS.every((s) => (recurrenceOffsets[s.key] ?? []).length > 0)
  const saveNow = () => {
    const holiday_offsets: Record<string, number[]> = {}
    for (const k of KATEGORI) {
      const raw = holidayOffsetTexts[k.key]?.trim()
      if (raw) {
        holiday_offsets[k.key] = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
      }
    }
    save.mutate({
      ...form,
      default_offsets: offsetsText.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)),
      holiday_offsets,
      // Required by the API — the old frontend omitted it and every settings
      // PUT 400ed; all four lists ride along with every save.
      recurrence_offsets: recurrenceOffsets,
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reminder Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Timezone</FieldLabel>
            <TimezoneSelect value={form.timezone} onChange={(tz) => set({ timezone: tz })} />
            <FieldDescription>Sets "today" for the calendar and the reminder send time.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="send-time">Send time (HH:MM)</FieldLabel>
            <Input id="send-time" value={form.send_time} onChange={(e) => set({ send_time: e.target.value })} />
          </Field>

          <Field>
            <FieldLabel htmlFor="catch-up">Catch-up window (hours)</FieldLabel>
            <Input
              id="catch-up"
              type="number"
              value={form.catch_up_hours}
              onChange={(e) => set({ catch_up_hours: Number(e.target.value) })}
            />
            <FieldDescription>Reminders missed while the device was off.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="offsets">Default offsets (days before D, comma-separated)</FieldLabel>
            <Input id="offsets" value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} />
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Holiday reminder categories</legend>
            {KATEGORI.map((k) => {
              const enabled = form.holiday_categories[k.key] ?? false
              return (
                <div key={k.key} className="space-y-1.5 rounded-lg border p-2.5">
                  {/* A span, not a label: a wrapping <label> forwards a second,
                      opposite click to the Checkbox's hidden input. The Checkbox
                      carries its own aria-label instead. */}
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(c) => set({ holiday_categories: { ...form.holiday_categories, [k.key]: c === true } })}
                      aria-label={`Toggle ${k.label} holiday reminders`}
                    />
                    {k.label}
                  </span>
                  <div className="ps-6">
                    <Field>
                      <FieldLabel htmlFor={`holiday-offsets-${k.key}`} className="text-xs">
                        Reminder offsets (days before, e.g. 7,1,0)
                      </FieldLabel>
                      <Input
                        id={`holiday-offsets-${k.key}`}
                        value={holidayOffsetTexts[k.key] ?? ''}
                        onChange={(e) => setHolidayOffsetTexts((s) => ({ ...s, [k.key]: e.target.value }))}
                        placeholder={`default: ${offsetsText}`}
                        disabled={!enabled}
                        className="h-7 w-40 text-xs"
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Unchecked sources stop notifying and are hidden from the calendar.
                Empty offsets fall back to the default offsets above.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  set({ holiday_categories: { pawukon: true, saka: true, national: true } })
                  setHolidayOffsetTexts({})
                }}
              >
                Reset to default
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurrence offsets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Default reminder offsets per occurrence stream, used when neither the occasion nor the
            contact sets a list. Days before the date, comma-separated; every stream needs at least
            one offset (0 = on the day). Saved with the Settings above.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RECURRENCE_STREAMS.map((s) => (
              <Field key={s.key}>
                <FieldLabel htmlFor={`rec-offsets-${s.key}`}>{s.label}</FieldLabel>
                <Input
                  id={`rec-offsets-${s.key}`}
                  value={recurrenceTexts[s.key] ?? ''}
                  onChange={(e) => setRecurrenceTexts((t) => ({ ...t, [s.key]: e.target.value }))}
                  placeholder={s.placeholder}
                />
              </Field>
            ))}
          </div>
          {!recurrenceOffsetsValid && (
            <p className="text-sm text-red-600">Every stream needs at least one offset.</p>
          )}
        </CardContent>
      </Card>

      {/* One Save for both cards — they share the settings PUT. */}
      <Button onClick={saveNow} disabled={save.isPending || !recurrenceOffsetsValid}>Save</Button>

      {me.data && (
        <p className="text-sm text-muted-foreground">
          Signed in as <b>{me.data.email}</b> ({me.data.role}) — dev mode via the X-Dev-Email header;
          production via Cloudflare Access.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `web/src/routes/reminder.settings.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { SettingsPageContent } from '@/components/settings/settings-page-content'

export const Route = createFileRoute('/reminder/settings')({
  component: SettingsPage,
  head: () => ({ meta: [{ title: pageTitle('Settings') }] }),
})

function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>
      <SettingsPageContent />
    </div>
  )
}
```

- [ ] **Step 4: Build and lint**

Run: `cd web && pnpm build && pnpm lint`
Expected: tsc + vite build succeed, oxlint clean (no new warnings).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/settings/timezone-select.tsx \
  web/src/components/settings/settings-page-content.tsx \
  web/src/routes/reminder.settings.tsx
git commit -m "refactor(web): extract settings page into domain components"
```

---

### Task 2: Channels domain components + thin channels route

**Files:**
- Create: `web/src/components/channels/channel-list.tsx`
- Create: `web/src/components/channels/add-channel-dialog.tsx`
- Modify: `web/src/routes/reminder.channels.tsx` (full rewrite, 212 → ~40 lines)

**Interfaces:**
- Consumes: `api`, `type Channel`, `type Settings` from `@/lib/api`; `ChannelIcon` from `@/lib/channel-icons`; UI primitives `AlertDialog*`, `Alert*`, `Badge`, `Button`, `Card`, `Checkbox`, `Dialog*`, `Empty*`, `Input`, `Select*`, `Skeleton`, `Switch`.
- Produces: `ChannelList({ onAdd }: { onAdd: () => void })` (the empty state's Add button calls it) and `AddChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })`. The route consumes both.

- [ ] **Step 1: Create `web/src/components/channels/channel-list.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { api, type Channel, type Settings } from '@/lib/api'
import { ChannelIcon } from '@/lib/channel-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

/** The channel list with its row actions. Owns the channels + settings
 *  queries and the row mutations; the add surface is AddChannelDialog,
 *  hosted by the route (`onAdd` opens it from the empty state). */
export function ChannelList({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })

  // Toggling a channel's "Default" saves immediately — same inline-edit model
  // as the card's active switch. The default channels receive the reminders of
  // contacts without their own selection.
  const setDefault = useMutation({
    mutationFn: (ids: string[]) =>
      api('/settings', { method: 'PUT', body: JSON.stringify({ ...settings.data, default_channel_ids: ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => toast.error(`Failed to save default channel: ${String(e)}`),
  })
  const isDefault = (id: string) => (settings.data?.default_channel_ids ?? []).includes(id)
  const toggleDefault = (id: string, on: boolean) => {
    const cur = new Set(settings.data?.default_channel_ids ?? [])
    if (on) cur.add(id)
    else cur.delete(id)
    setDefault.mutate([...cur])
  }
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      api(`/channels/${v.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v.enabled }) }),
    onSuccess: invalidate,
  })
  const del = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
  const test = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/test`, { method: 'POST' }),
    onSuccess: () => toast.success('Test succeeded — notification sent.'),
    onError: (e) => toast.error(`Test failed: ${String(e)}`),
  })

  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-[70px] w-full rounded-xl" />
        <Skeleton className="h-[70px] w-full rounded-xl" />
        <Skeleton className="h-[70px] w-full rounded-xl" />
      </div>
    )
  if (q.isError) return <p className="text-red-600">{String(q.error)}</p>

  const channels = q.data?.channels ?? []
  if (channels.length === 0)
    return (
      <Empty className="rounded-xl border py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChannelIcon type="gotify" className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No channels yet</EmptyTitle>
          <EmptyDescription>
            Add a Gotify, Telegram, or email channel so reminders actually get delivered.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onAdd}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            Add channel
          </Button>
        </EmptyContent>
      </Empty>
    )

  return (
    <div className="space-y-3">
      {channels.map((ch) => (
        <Card key={ch.id} className="flex flex-row items-center gap-3 p-3">
          <Badge variant={ch.enabled ? 'default' : 'secondary'}>{ch.type}</Badge>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <ChannelIcon type={ch.type} className="size-4" />
              <p className="truncate font-medium">{ch.name}</p>
            </div>
            <p className="text-xs text-muted-foreground">{ch.enabled ? 'active' : 'inactive'}</p>
          </div>
          {/* A span, not a label: a wrapping <label> forwards a second, opposite
              click to the Checkbox's hidden input. The Checkbox carries its own
              aria-label instead. */}
          <span className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={isDefault(ch.id)}
              disabled={!settings.data || setDefault.isPending}
              onCheckedChange={(v) => toggleDefault(ch.id, v === true)}
              aria-label="Set as default channel"
            />
            Default
          </span>
          {/* Same: the Switch must not be wrapped in a label. */}
          <span className="flex items-center gap-1.5 text-sm">
            <Switch
              checked={ch.enabled}
              onCheckedChange={(v) => toggle.mutate({ id: ch.id, enabled: v === true })}
              aria-label="Toggle channel active"
            />
            active
          </span>
          <Button variant="outline" size="sm" onClick={() => test.mutate(ch.id)} disabled={test.isPending}>
            Test
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm">Delete</Button>}
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete channel {ch.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This channel can no longer be used to send reminders.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => del.mutate(ch.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `web/src/components/channels/add-channel-dialog.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const TIPE = ['gotify', 'telegram', 'email'] as const

const FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  gotify: [
    { key: 'base_url', label: 'Gotify Base URL' },
    { key: 'token', label: 'App Token' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token (from @BotFather)' },
    { key: 'chat_id', label: 'Chat ID (user/group)' },
  ],
  email: [
    { key: 'host', label: 'SMTP Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'from', label: 'Sender address' },
    { key: 'to', label: 'To (comma-separated)' },
  ],
}

/** Add-channel dialog: type + name + per-type config (stored encrypted).
 *  The route owns the open state; on success the form resets and the
 *  dialog closes. */
export function AddChannelDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [type, setType] = useState<(typeof TIPE)[number]>('gotify')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<Record<string, string | number>>({})

  const create = useMutation({
    mutationFn: () => api('/channels', { method: 'POST', body: JSON.stringify({ type, name, config: cfg }) }),
    onSuccess: () => {
      setName('')
      setCfg({})
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Channel created')
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-left">Add channel</DialogTitle>
          <DialogDescription className="text-left">
            A delivery channel for reminders — Gotify, Telegram, or email.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <div className="flex flex-wrap gap-2">
            <Select
              value={type}
              onValueChange={(v) => {
                if (!v) return
                setType(v as typeof type)
                setCfg({})
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {TIPE.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. gotify-home)"
              className="flex-1"
            />
          </div>
          {FIELDS[type].map((f) => (
            <Input key={f.key} type={f.type ?? 'text'} required
              value={cfg[f.key] ?? ''}
              onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
              placeholder={f.label} />
          ))}
          <Button type="submit" disabled={!name.trim() || create.isPending}>Save</Button>
          <Alert>
            <AlertTitle>Config is stored encrypted (AES-256-GCM)</AlertTitle>
            <AlertDescription>It cannot be viewed again after saving.</AlertDescription>
          </Alert>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Rewrite `web/src/routes/reminder.channels.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { pageTitle } from '../lib/page-title'
import { AddChannelDialog } from '@/components/channels/add-channel-dialog'
import { ChannelList } from '@/components/channels/channel-list'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/reminder/channels')({
  component: Channels,
  head: () => ({ meta: [{ title: pageTitle('Channels') }] }),
})

function Channels() {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-4">
      {/* Page header — the dashboard's pattern: title left, primary action
          right. Every reminder page leads with this row. */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Notification Channels</h1>
          <p className="text-sm text-muted-foreground">
            Contacts without their own channel selection use the default ones. No default — every
            enabled channel is used.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setAddOpen(true)}>
          Add channel
        </Button>
      </div>

      <ChannelList onAdd={() => setAddOpen(true)} />
      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
```

- [ ] **Step 4: Build and lint**

Run: `cd web && pnpm build && pnpm lint`
Expected: tsc + vite build succeed, oxlint clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/channels/channel-list.tsx \
  web/src/components/channels/add-channel-dialog.tsx \
  web/src/routes/reminder.channels.tsx
git commit -m "refactor(web): extract channels page into domain components"
```

---

### Task 3: Verification pass

**Files:** none (verification only; fix-forward if issues surface).

**Interfaces:**
- Consumes: everything built in Tasks 1–2.
- Produces: verified deliverable.

- [ ] **Step 1: Full build + lint from a clean state**

Run: `cd web && rm -rf dist && pnpm build && pnpm lint`
Expected: success, no type or lint errors.

- [ ] **Step 2: Dev-server pass (needs the Go backend running; hand the checklist to the user if the stack isn't available locally)**

Start: `cd web && pnpm dev` (plus the backend per repo README/Makefile). Check on `/reminder/settings`:

- Page renders title + skeleton briefly, then both cards; no `Loading…` text.
- Change timezone → label shows GMT suffix; pick a stored-but-unlisted timezone in the DB → it still appears ("— stored value").
- Edit send time, catch-up, default offsets → Save (the single button at the bottom) → "Saved." toast; reload persists.
- Uncheck a holiday category → its offsets input disables; Reset to default re-checks all three and clears offsets.
- Empty a recurrence stream → Save disables + error line; refill → Save re-enables.
- Footer shows signed-in email/role.

Check on `/reminder/channels`:

- Header row: title + description left, Add channel button right.
- With zero channels: dashed empty state with a working "Add channel" button that opens the dialog.
- Add channel → dialog opens; create a channel → success toast, dialog closes, list shows it.
- Default checkbox toggles and persists; active Switch toggles; Test sends (toast success/failure); Delete asks and removes.
- Browser back/forward and direct URL loads still work for both routes.

- [ ] **Step 3: Final commit (only if fix-forward changes were needed)**

```bash
git add -u web/src
git commit -m "fix(web): channels/settings refactor follow-ups"
```
