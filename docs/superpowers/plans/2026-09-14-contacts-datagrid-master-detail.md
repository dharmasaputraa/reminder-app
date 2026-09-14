# Contacts Data Grid + Master–Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the contacts page as a reui data-grid with a docked full-detail right section on `lg+` (selection in the URL as `?c=`), fullscreen routes for detail/create, and consistent CRUD (identity editing, delete from panel + row action).

**Architecture:** Route-based master–detail (spec: `docs/superpowers/specs/2026-09-14-contacts-datagrid-master-detail-design.md`). One shared `ContactDetailContent` component renders both the docked panel and the fullscreen pages (`/reminder/contacts/$id`, `/reminder/contacts/new`); a `ContactsGrid` composes reui data-grid primitives over the existing `/contacts` + `/upcoming` endpoints with client-side search/sort/pagination.

**Tech Stack:** React 19, TanStack Router (file-based) + TanStack Query, reui registry (`base-nova`, Base UI `render` prop API), TanStack Table v9 (via `@reui/data-grid`), Tailwind v4, Go backend (unchanged).

## Global Constraints

- **Zero backend changes.** `POST /contacts` already accepts `{name, nickname, notes}` and returns 201 with the created contact; `PATCH /contacts/:id` already updates identity; `/upcoming` already supports `from`/`to` (max 400 days).
- Run all `pnpm` commands from `web/`. Verification per task: `pnpm exec tsc -b` (must be green), `pnpm lint`.
- `tsconfig` has `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax` — no unused imports; type-only imports must use `import type`.
- Registry is preconfigured in `web/components.json` (`@reui` → `https://reui.io/r/{style}/{name}.json`, style `base-nova`). Do not change `components.json`.
- Do not hand-pin dependency versions for installed registry components; let the shadcn CLI write `package.json`.
- URL/history contract (spec): row selection **replace**; Expand **push**; Collapse **replace**; Add → `?c=new` **replace** on lg+, `/new` push on <lg; after create **replace** to the new id; after delete drop `c` (docked, **replace**) or go to list (page).
- Below `lg` (reuse `useIsLg` from `@/hooks/use-lg`): no panel; rows/Add navigate to the fullscreen routes.
- Grid: no row-selection checkboxes, no bulk delete. Column defaults: Name/Next reminder/Occasions/Status visible; Notes hidden; Name + Actions not hideable.
- Search/sort/pagination are client-side. Countdown counts to the occasion date; paused contacts still show their next occasion.
- Mutations: `toast.error` on failure, success toasts for create/update/delete (sonner).
- New files use `@/...` alias imports (matches `src/components/*` convention).

---

### Task 1: Install reui data-grid primitives + textarea, adapt examples

**Files:**
- Create (via CLI): `web/src/components/reui/data-grid/**`, `web/src/components/reui/frame.tsx`, `web/src/components/ui/input-group.tsx`, `web/src/hooks/use-copy-to-clipboard.ts`, plus any transitive files the CLI reports (`ui/spinner.tsx` etc.)
- Create (via CLI): `web/src/components/examples/c-data-grid-23.tsx`, `web/src/components/examples/c-data-grid-20.tsx`
- Create (via CLI): `web/src/components/ui/textarea.tsx`
- Modify: `web/package.json`, `web/pnpm-lock.yaml` (CLI-driven)

**Interfaces:**
- Consumes: existing `components.json` registry config.
- Produces: `@/components/reui/data-grid/data-grid` (exports `DataGrid`, `dataGridFeatures`, `useDataGrid`), `data-grid-table` (`DataGridTable`), `data-grid-column-header` (`DataGridColumnHeader`), `data-grid-pagination` (`DataGridPagination`), `data-grid-scroll-area` (`DataGridScrollArea`), `data-grid-column-visibility` (`DataGridColumnVisibility`), `@/components/reui/frame` (`Frame`, `FrameHeader`, `FrameTitle`, `FramePanel`, `FrameFooter`, `FrameDescription`), `@/components/ui/input-group`, `@/components/ui/textarea`. Tasks 3–5 import exactly these names.

- [ ] **Step 1: Install the registry components**

```bash
cd /Users/taksu/Work/code/otorem/web
pnpm dlx shadcn@latest add @reui/c-data-grid-23 @reui/c-data-grid-20 --yes
pnpm dlx shadcn@latest add textarea --yes
```

Expected: CLI reports new files under `src/components/reui/data-grid/`, `src/components/reui/frame.tsx`, `src/components/ui/input-group.tsx`, `src/components/ui/textarea.tsx`, `src/hooks/use-copy-to-clipboard.ts`, the two examples under `src/components/examples/`, and adds `@tanstack/react-table` (plus transitive deps such as `@tanstack/react-virtual`, `@dnd-kit/*`) to `package.json`.

- [ ] **Step 2: Replace IconPlaceholder in the two new examples**

The examples import `IconPlaceholder` from `@/app/(create)/components/icon-placeholder`, which does not exist in this project (tsc would fail). In **both** `src/components/examples/c-data-grid-23.tsx` and `c-data-grid-20.tsx`:

1. Delete the `import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"` line.
2. For every `<IconPlaceholder lucide="XIcon" ... />` element, replace the whole element with `<XIcon aria-hidden="true" />` and add `XIcon` to the `lucide-react` import. (`c-data-grid-23` uses at least `SearchIcon`, `XIcon`, `FunnelIcon`, `UserPlusIcon`, `MoreHorizontalIcon`; `c-data-grid-20` uses `Settings2Icon` and/or `SlidersHorizontalIcon` — always follow the element's `lucide="..."` hint.)

- [ ] **Step 3: Sweep for other known breakages**

```bash
cd /Users/taksu/Work/code/otorem/web
grep -rn "process\.env" src/components/reui/data-grid src/components/reui/frame.tsx src/components/examples/c-data-grid-23.tsx src/components/examples/c-data-grid-20.tsx src/hooks/use-copy-to-clipboard.ts
grep -n "DropdownMenuCheckboxItem" src/components/ui/dropdown-menu.tsx
```

Expected: the `process.env` grep finds nothing (if it does, replace with `import.meta.env.DEV` per `web/SHADCN.md`); the dropdown grep finds the export (the column-visibility primitive needs it — this project's `dropdown-menu.tsx` already has it).

- [ ] **Step 4: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: both pass with no errors.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): install reui data-grid primitives, frame, input-group, textarea"
```

---

### Task 2: Contacts URL search contract

**Files:**
- Create: `web/src/lib/contacts-search.ts`
- Modify: `web/src/routes/reminder.contacts.index.tsx` (add `validateSearch` only — the file is fully rewritten in Task 5)

**Interfaces:**
- Consumes: nothing.
- Produces: `validateContactsSearch(search: Record<string, unknown>): ContactsSearch` and `interface ContactsSearch { c?: string }` — Task 3's navigation (`search: { c: id }`) and Task 5's route definition and `nav({ search })` calls type-check against these.

- [ ] **Step 1: Write `web/src/lib/contacts-search.ts`**

```ts
/** URL search contract for /reminder/contacts — see
 *  docs/superpowers/specs/2026-09-14-contacts-datagrid-master-detail-design.md. */
export interface ContactsSearch {
  /** Docked right-section target: a contact id or `new`. Absent = no panel. */
  c?: string
}

const C_RE = /^(new|\d+)$/

/** Route `validateSearch`: invalid params are overwritten with undefined.
 *  NOTE: this router version merges the validator's return over the raw
 *  search (Object.assign in router-core), so simply omitting an invalid key
 *  would leave its raw value in the typed search. Writing undefined clears
 *  it, and the search serializer drops undefined values, so the URL cleans
 *  itself up on the next navigation. (Same note as validateReminderSearch.) */
export function validateContactsSearch(
  search: Record<string, unknown>
): ContactsSearch {
  const c =
    typeof search.c === 'string' && C_RE.test(search.c) ? search.c : undefined
  return { c }
}
```

- [ ] **Step 2: Wire it into the existing index route**

In `web/src/routes/reminder.contacts.index.tsx`, add the import and the `validateSearch` line (leave everything else untouched):

```ts
import { validateContactsSearch } from '../lib/contacts-search'
```

```ts
export const Route = createFileRoute('/reminder/contacts/')({
  validateSearch: validateContactsSearch,
  component: Contacts,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/contacts-search.ts web/src/routes/reminder.contacts.index.tsx
git commit -m "feat(web): contacts search-param contract (?c=<id|new>)"
```

---

### Task 3: Shared `ContactDetailContent` + fullscreen routes

**Files:**
- Create: `web/src/lib/initials.ts`
- Create: `web/src/components/contacts/contact-detail-content.tsx`
- Modify: `web/src/routes/reminder.contacts.$id.tsx` (full rewrite, becomes 3 lines of logic)
- Create: `web/src/routes/reminder.contacts.new.tsx`
- Move code from: `web/src/routes/reminder.contacts.$id.tsx` (occasions/prefs logic moves verbatim into the shared component)

**Interfaces:**
- Consumes: `validateContactsSearch` (Task 2) so `search: { c: id }` type-checks; `@/components/ui/textarea` (Task 1); existing `DateSelectorPopover`, `hydratePrefsForm`, `api`, `pageTitle`.
- Produces: `ContactDetailContent({ contactId, variant }: { contactId: number | 'new'; variant: 'docked' | 'page' })` and `initials(name: string): string` (from `@/lib/initials`) — Task 4's grid and Task 5's index route import both.

- [ ] **Step 1: Write `web/src/lib/initials.ts`**

```ts
/** Up to two leading initials for avatars ("Made Wijaya" → "MW"). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}
```

- [ ] **Step 2: Write `web/src/components/contacts/contact-detail-content.tsx`**

The occasions/preferences cards below are moved verbatim from the current `reminder.contacts.$id.tsx`; the identity form is new (spec: explicit Save, dirty-gated; create mode shows identity only, with a hint that occasions/prefs come after saving).

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Maximize2Icon, Minimize2Icon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { hydratePrefsForm } from '@/lib/prefs'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const TIPE: { value: string; label: string }[] = [
  { value: 'otonan', label: 'Otonan (210-day Pawukon)' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
]

/** ISO yyyy-MM-dd → "18/06/2003 (Wednesday, 18 June 2003)". */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'dd/MM/yyyy (EEEE, d MMMM yyyy)')
}

interface ContactDetailContentProps {
  /** Numeric contact id, or 'new' for the create form. */
  contactId: number | 'new'
  /** docked = right section of /reminder/contacts; page = fullscreen route. */
  variant: 'docked' | 'page'
}

export function ContactDetailContent({ contactId, variant }: ContactDetailContentProps) {
  const isNew = contactId === 'new'
  const id = String(contactId)
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
    enabled: !isNew,
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  // --- identity form (new capability; dirty-gated explicit save) ---
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!contact.data) return
    setName(contact.data.name)
    setNickname(contact.data.nickname)
    setNotes(contact.data.notes)
  }, [contact.data])

  const identityDirty = !contact.data
    ? name.trim() !== '' // create: ready as soon as there is a name
    : name !== contact.data.name || nickname !== contact.data.nickname || notes !== contact.data.notes

  // --- occasions + preferences form state (moved from the detail page) ---
  const [type, setType] = useState('otonan')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')
  const [offsets, setOffsets] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!contact.data) return
    const form = hydratePrefsForm(contact.data.prefs)
    setOffsets(form.offsets)
    setEnabled(form.enabled)
  }, [contact.data])

  async function previewPawukon(d: string) {
    setPawukon('')
    if (!d || type !== 'otonan') return
    try { setPawukon((await api<{ label: string }>(`/pawukon?date=${d}`)).label) } catch { /* stay silent */ }
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
    // Prefix match also refreshes ['upcoming', 'grid'] (next-reminder column)
    // and the dashboard's ['upcoming', days] / ['upcoming-year', y] queries.
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }

  const saveIdentity = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ name: name.trim(), nickname: nickname.trim(), notes })
      return isNew
        ? api<Contact>('/contacts', { method: 'POST', body })
        : api(`/contacts/${id}`, { method: 'PATCH', body })
    },
    onSuccess: (saved) => {
      if (isNew) {
        // Spec: after create, replace so no `new` URL stays in history.
        if (variant === 'docked')
          nav({ to: '/reminder/contacts', search: { c: String(saved.id) }, replace: true })
        else nav({ to: '/reminder/contacts/$id', params: { id: String(saved.id) }, replace: true })
        toast.success('Contact created')
      } else {
        toast.success('Contact updated')
      }
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact', String(saved.id)] })
    },
    onError: (e) => toast.error(`Failed to save contact: ${String(e)}`),
  })

  const addOcc = useMutation({
    mutationFn: () => api(`/contacts/${id}/occasions`, { method: 'POST', body: JSON.stringify({ type, date }) }),
    onSuccess: () => { setDate(''); setDateSel(undefined); setPawukon(''); invalidate() },
  })
  const delOcc = useMutation({
    mutationFn: (oid: number) => api(`/occasions/${oid}`, { method: 'DELETE' }), onSuccess: invalidate,
  })
  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/contacts/${id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Failed to save preferences: ${String(e)}`),
  })
  const delContact = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Contact deleted')
      // Spec: docked drops ?c (replace); fullscreen goes back to the list.
      if (variant === 'docked') nav({ to: '/reminder/contacts', search: {}, replace: true })
      else nav({ to: '/reminder/contacts', replace: true })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  if (!isNew && contact.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  if (!isNew && contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2">
        <p className="font-medium">{notFound ? 'Contact not found' : 'Failed to load contact'}</p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
        <Button variant="outline" size="sm" onClick={() => nav({ to: '/reminder/contacts' })}>
          Back to contacts
        </Button>
      </div>
    )
  }
  const c = isNew ? undefined : contact.data!

  // One occasion per type: types the contact already has are disabled in the
  // type select and the Add button locks (moved logic, unchanged).
  const existingTypes = new Set(c?.occasions.map((o) => o.type))
  const typeItems = TIPE.map((t) => ({
    label: t.label,
    value: t.value,
    disabled: existingTypes.has(t.value),
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {c && (
            <Avatar>
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
          )}
          <h1 className="truncate text-xl font-bold">{isNew ? 'New contact' : c?.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Expand (docked → fullscreen, push) / Collapse (fullscreen →
              docked, replace) — history contract in the spec. */}
          {variant === 'docked' ? (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Expand to fullscreen"
              onClick={() =>
                nav(isNew ? { to: '/reminder/contacts/new' } : { to: '/reminder/contacts/$id', params: { id } })
              }
            >
              <Maximize2Icon aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back to list"
              onClick={() =>
                nav(
                  isNew
                    ? { to: '/reminder/contacts', replace: true }
                    : { to: '/reminder/contacts', search: { c: id }, replace: true },
                )
              }
            >
              <Minimize2Icon aria-hidden="true" />
            </Button>
          )}
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm">Delete contact</Button>}
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {c?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All occasions and reminder preferences for this contact will be deleted too.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => delContact.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {isNew && (
        <p className="text-sm text-muted-foreground">
          Occasions and reminder preferences can be added after saving.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isNew ? 'Identity' : 'Details'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${variant}-contact-name`}>Name</Label>
              <Input
                id={`${variant}-contact-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Made Wijaya)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${variant}-contact-nickname`}>Nickname</Label>
              <Input
                id={`${variant}-contact-nickname`}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${variant}-contact-notes`}>Notes</Label>
            <Textarea
              id={`${variant}-contact-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
              onClick={() => saveIdentity.mutate()}
            >
              {isNew ? 'Create contact' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isNew && c && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Occasions</CardTitle>
            </CardHeader>
            <CardContent>
              {c.occasions.map((o) => (
                <div key={o.id} className="flex items-center justify-between border-b py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                    {longDate(o.base_date)}
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="destructive" size="sm">Delete</Button>} />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {o.type} {o.base_date} will be permanently deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => delOcc.mutate(o.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Select
                  items={typeItems}
                  value={type}
                  onValueChange={(v) => {
                    if (!v) return
                    setType(v)
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {typeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <DateSelectorPopover
                  value={dateSel}
                  onApply={(v) => {
                    setDateSel(v)
                    const d = dateSelectorValueToDate(v)
                    const iso = d ? format(d, 'yyyy-MM-dd') : ''
                    setDate(iso)
                    previewPawukon(iso)
                  }}
                  placeholder="Pick a date"
                  minYear={1800}
                  maxYear={new Date().getFullYear() + 10}
                  weekStartsOn={1}
                  allowRange={false}
                  periodTypes={['day', 'month', 'year']}
                  monthCascadesToDay
                  showFilterTypes={false}
                  className="w-56 justify-start"
                />
                <Button disabled={!date || existingTypes.has(type) || addOcc.isPending} onClick={() => addOcc.mutate()}>Add</Button>
              </div>
              {existingTypes.has(type) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This contact already has this type of occasion — only one of each type is allowed.
                </p>
              )}
              {pawukon && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
              {type === 'birthday' && date.endsWith('-02-29') && (
                <p className="mt-2 text-xs text-muted-foreground">Feb 29 in non-leap years is observed on March 1.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reminder Preferences</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-sm text-muted-foreground">
                Global default: {(settings.data?.default_offsets ?? []).map((n) => `D-${n}`).join(', ')} · send time {settings.data?.send_time}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={offsets} onChange={(e) => setOffsets(e.target.value)} placeholder="offsets, e.g. 7,4,2,1,0 (empty = default)"
                  className="flex-1" />
                <label className="flex items-center gap-1.5 text-sm">
                  <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
                  active
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {channels.data?.channels.map((ch) => (
                  <label key={ch.id} className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-sm">
                    <Checkbox
                      defaultChecked={c.prefs?.channel_ids.includes(ch.id) ?? false}
                      onCheckedChange={(v) => {
                        const cur = new Set(c.prefs?.channel_ids ?? [])
                        if (v === true) cur.add(ch.id)
                        else cur.delete(ch.id)
                        savePrefs.mutate({ channel_ids: [...cur] })
                      }}
                    />
                    {ch.name} ({ch.type})
                  </label>
                ))}
              </div>
              <Button
                className="mt-3"
                onClick={() => savePrefs.mutate({
                  offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [],
                  enabled,
                })}
              >
                Save preferences
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `web/src/routes/reminder.contacts.$id.tsx`**

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'

export const Route = createFileRoute('/reminder/contacts/$id')({
  beforeLoad: ({ params }) => {
    // /new has its own static route; anything else non-numeric is a bad URL.
    if (!/^\d+$/.test(params.id)) throw redirect({ to: '/reminder/contacts' })
  },
  component: ContactDetailPage,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

function ContactDetailPage() {
  const { id } = Route.useParams()
  return <ContactDetailContent contactId={Number(id)} variant="page" />
}
```

- [ ] **Step 4: Create `web/src/routes/reminder.contacts.new.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'

export const Route = createFileRoute('/reminder/contacts/new')({
  component: () => <ContactDetailContent contactId="new" variant="page" />,
  head: () => ({ meta: [{ title: pageTitle('New contact') }] }),
})
```

- [ ] **Step 5: Verify typecheck + lint, then check route tree generation**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass. (The TanStack Router vite plugin regenerates the route tree on dev/build; `tsc` accepts the new route files because `routeTree.gen.ts` is regenerated by the plugin on the next `vite`/`vite build` run — if `tsc` complains about unknown route `/reminder/contacts/new` in the `nav({ to: ... })` calls, run `pnpm exec vite build --mode development 2>/dev/null || true; pnpm exec tsr generate 2>/dev/null || true` once, or simply run `pnpm dev` for a second to let the plugin regenerate `routeTree.gen.ts`, then stop it and re-run tsc.)

- [ ] **Step 6: Manual check on the dev server**

Run backend + web (`make dev` serves the API on :8080; in `web/`, `pnpm dev` proxies `/api`):

- `/reminder/contacts/1` (any real id): identity form edits + Save works; occasions/prefs behave as before.
- `/reminder/contacts/new`: empty form; Create lands on `/reminder/contacts/<new id>` with toast.
- Non-numeric `/reminder/contacts/abc` redirects to the list.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/initials.ts web/src/components/contacts/contact-detail-content.tsx web/src/routes/reminder.contacts.\$id.tsx web/src/routes/reminder.contacts.new.tsx
git commit -m "feat(web): shared contact detail surface with identity editing + /new create route"
```

---

### Task 4: `ContactsGrid` component + next-reminder join

**Files:**
- Create: `web/src/components/contacts/contacts-grid.tsx`

**Interfaces:**
- Consumes: reui primitives (Task 1), `initials` (Task 3), `api` types.
- Produces (Task 5 imports): `ContactsGrid({ contacts, nextById, selectedId, isLoading, onSelect, onAdd, onRequestDelete })` and `useNextReminderMap(): { map: Map<number, UpcomingItem>; isLoading: boolean }`. `ContactRow = Contact & { next?: UpcomingItem }` is the row type.

- [ ] **Step 1: Write `web/src/components/contacts/contacts-grid.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { addDays, format } from 'date-fns'
import { useTable } from '@tanstack/react-table'
import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table'
import { PlusIcon, SearchIcon, Settings2Icon, StickyNoteIcon, XIcon } from 'lucide-react'
import { api, type Contact, type UpcomingItem } from '@/lib/api'
import { initials } from '@/lib/initials'
import { Badge } from '@/components/reui/badge'
import { DataGrid, dataGridFeatures, type DataGridFeatures } from '@/components/reui/data-grid/data-grid'
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header'
import { DataGridColumnVisibility } from '@/components/reui/data-grid/data-grid-column-visibility'
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination'
import { DataGridScrollArea } from '@/components/reui/data-grid/data-grid-scroll-area'
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table'
import { Frame, FrameFooter, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'

/** Grid row = contact + its earliest upcoming occasion (absent when none
 *  falls inside the 400-day window). */
export interface ContactRow extends Contact {
  next?: UpcomingItem
}

/** contact_id → earliest occasion inside the endpoint's max 400-day window.
 *  Holidays are excluded; the countdown counts to the occasion date, not the
 *  first reminder send, and paused contacts still appear (spec). Failure
 *  degrades to an empty map — the column shows "—", the grid still works. */
export function useNextReminderMap(): {
  map: Map<number, UpcomingItem>
  isLoading: boolean
} {
  const today = new Date()
  const from = format(today, 'yyyy-MM-dd')
  const to = format(addDays(today, 400), 'yyyy-MM-dd')
  const q = useQuery({
    queryKey: ['upcoming', 'grid', from],
    queryFn: () => api<{ items: UpcomingItem[] }>(`/upcoming?from=${from}&to=${to}`),
  })
  const map = useMemo(() => {
    const m = new Map<number, UpcomingItem>()
    const items = (q.data?.items ?? [])
      .filter((it) => it.kind === 'occasion' && it.contact_id != null)
      .sort((a, b) => a.date.localeCompare(b.date))
    for (const it of items) if (!m.has(it.contact_id!)) m.set(it.contact_id!, it)
    return m
  }, [q.data])
  return { map, isLoading: q.isLoading }
}

function ActionsCell({
  row,
  onSelect,
  onRequestDelete,
}: {
  row: Row<DataGridFeatures, ContactRow>
  onSelect: (id: number) => void
  onRequestDelete: (contact: Contact) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="size-7"
            size="icon"
            variant="ghost"
            aria-label={`Actions for ${row.original.name}`}
            // The row behind this cell opens the detail on click; the menu
            // trigger must not bubble into it (same pattern as the grid's
            // built-in pin button).
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onSelect(row.original.id)}>Open</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRequestDelete(row.original)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface ContactsGridProps {
  contacts: Contact[]
  nextById: Map<number, UpcomingItem>
  selectedId?: number
  isLoading?: boolean
  /** Row click / Open — the parent decides docked selection vs. navigation. */
  onSelect: (id: number) => void
  onAdd: () => void
  /** Called after the confirm dialog; the parent owns the DELETE mutation. */
  onRequestDelete: (contact: Contact) => void
}

export function ContactsGrid({
  contacts,
  nextById,
  selectedId,
  isLoading,
  onSelect,
  onAdd,
  onRequestDelete,
}: ContactsGridProps) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [searchQuery, setSearchQuery] = useState('')

  const rows = useMemo<ContactRow[]>(
    () => contacts.map((c) => ({ ...c, next: nextById.get(c.id) })),
    [contacts, nextById],
  )

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.nickname.toLowerCase().includes(q),
    )
  }, [rows, searchQuery])

  // Spec: pagination resets when search or sorting changes.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }, [searchQuery, sorting])

  const columns = useMemo<ColumnDef<DataGridFeatures, ContactRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        header: ({ column }) => <DataGridColumnHeader title="Name" column={column} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.name}</div>
              {row.original.nickname && (
                <div className="text-muted-foreground truncate text-xs">{row.original.nickname}</div>
              )}
            </div>
          </div>
        ),
        enableSorting: true,
        enableHiding: false,
        enableResizing: false,
        size: 220,
        meta: { autoSize: true },
      },
      {
        id: 'next',
        // Missing next sorts last without a custom sortingFn.
        accessorFn: (row) => row.next?.days_until ?? Number.MAX_SAFE_INTEGER,
        header: ({ column }) => <DataGridColumnHeader title="Next reminder" column={column} />,
        cell: ({ row }) => {
          const n = row.original.next
          if (!n) return <span className="text-muted-foreground">—</span>
          return (
            <div className="flex items-center gap-2">
              <span className="truncate font-medium capitalize">
                {n.type} · {format(new Date(`${n.date}T00:00:00`), 'd MMM')}
              </span>
              <Badge variant={n.days_until <= 7 ? 'warning-outline' : 'secondary'} className="shrink-0">
                {n.days_until <= 0 ? 'today' : `in ${n.days_until}d`}
              </Badge>
            </div>
          )
        },
        enableSorting: true,
        enableHiding: true,
        enableResizing: false,
        size: 190,
      },
      {
        id: 'occasions',
        header: ({ column }) => <DataGridColumnHeader title="Occasions" column={column} />,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.occasions.length === 0 && <span className="text-muted-foreground">—</span>}
            {row.original.occasions.map((o) => (
              <Badge key={o.id} variant="secondary" className="uppercase">
                {o.type} {format(new Date(`${o.base_date}T00:00:00`), 'd MMM yyyy')}
              </Badge>
            ))}
          </div>
        ),
        enableSorting: false,
        enableHiding: true,
        enableResizing: false,
        size: 240,
      },
      {
        id: 'status',
        accessorFn: (row) => row.prefs?.enabled ?? true,
        header: ({ column }) => <DataGridColumnHeader title="Status" column={column} />,
        cell: ({ row }) =>
          row.original.prefs?.enabled === false ? (
            <Badge variant="warning-outline">Paused</Badge>
          ) : (
            <Badge variant="success-outline">Active</Badge>
          ),
        enableSorting: true,
        enableHiding: true,
        enableResizing: false,
        size: 100,
      },
      {
        id: 'notes',
        accessorFn: (row) => row.notes,
        header: ({ column }) => <DataGridColumnHeader title="Notes" column={column} />,
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <StickyNoteIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{row.original.notes}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        enableSorting: false,
        enableHiding: true,
        enableResizing: false,
        size: 160,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => <ActionsCell row={row} onSelect={onSelect} onRequestDelete={onRequestDelete} />,
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 60,
      },
    ],
    [onSelect, onRequestDelete],
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filtered,
    pageCount: Math.max(1, Math.ceil(filtered.length / pagination.pageSize)),
    getRowId: (row: ContactRow) => String(row.id),
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
  })

  return (
    <DataGrid
      table={table}
      recordCount={filtered.length}
      isLoading={isLoading}
      onRowClick={(row) => onSelect(row.id)}
      tableLayout={{
        columnsPinnable: false,
        columnsResizable: false,
        columnsMovable: false,
        columnsVisibility: true,
      }}
      emptyMessage={
        contacts.length === 0
          ? 'No contacts yet — add your first contact.'
          : 'No contacts match your search.'
      }
    >
      <Frame className="w-full" stacked dense>
        <FrameHeader className="flex w-full flex-row flex-wrap items-center justify-between gap-3">
          <FrameTitle>Contacts</FrameTitle>
          <div className="flex items-center gap-2.5">
            <InputGroup className="w-48 bg-background">
              <InputGroupAddon align="inline-start">
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search name or nickname…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.length > 0 && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label="Clear search"
                    title="Clear"
                    size="icon-xs"
                    onClick={() => setSearchQuery('')}
                  >
                    <XIcon aria-hidden="true" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
            <DataGridColumnVisibility
              table={table}
              trigger={
                <Button variant="outline" size="icon" aria-label="Toggle columns">
                  <Settings2Icon aria-hidden="true" />
                </Button>
              }
            />
            <Button onClick={onAdd}>
              <PlusIcon aria-hidden="true" />
              Add contact
            </Button>
          </div>
        </FrameHeader>
        <FramePanel className="p-0 shadow-none">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </FramePanel>
        <FrameFooter className="py-1.5 pr-2 pl-2.5">
          <DataGridPagination />
        </FrameFooter>
      </Frame>
    </DataGrid>
  )
}
```

Note: `selectedId` is accepted for the parent's future use (e.g. highlighting); the grid does not style rows by it in this iteration (the open panel is the selection feedback).

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass. If `ColumnDef`/`useTable` generics complain about the exact `DataGridFeatures` type, mirror the demo's import surface exactly (`useTable` as a value import from `@tanstack/react-table`, `ColumnDef<DataGridFeatures, ContactRow>`), which is what the installed `c-data-grid-23` example uses — compare against it.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/contacts/contacts-grid.tsx
git commit -m "feat(web): contacts data-grid with search, sorting, visibility, next-reminder column"
```

---

### Task 5: Master–detail index route

**Files:**
- Modify: `web/src/routes/reminder.contacts.index.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ContactsSearch`/`validateContactsSearch` (Task 2), `ContactDetailContent` + `initials` no longer needed here (Task 3), `ContactsGrid` + `useNextReminderMap` (Task 4), `useIsLg` (existing).
- Produces: the finished page.

- [ ] **Step 1: Rewrite `web/src/routes/reminder.contacts.index.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, type Contact } from '../lib/api'
import { validateContactsSearch, type ContactsSearch } from '../lib/contacts-search'
import { pageTitle } from '../lib/page-title'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'
import { ContactsGrid, useNextReminderMap } from '@/components/contacts/contacts-grid'
import { useIsLg } from '@/hooks/use-lg'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/reminder/contacts/')({
  validateSearch: validateContactsSearch,
  component: Contacts,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

function Contacts() {
  const { c } = Route.useSearch()
  const nav = Route.useNavigate()
  const qc = useQueryClient()
  const isLg = useIsLg()

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api<{ contacts: Contact[] }>('/contacts') })
  const next = useNextReminderMap()

  const selectedId = c && c !== 'new' ? Number(c) : undefined

  /** Spec history contract: docked selection REPLACES (browsing rows leaves
   *  one history entry); below lg a row is ordinary navigation to the page. */
  const select = (id: number) => {
    if (!isLg) {
      nav({ to: '/reminder/contacts/$id', params: { id: String(id) } })
      return
    }
    nav({ search: (prev: ContactsSearch) => ({ ...prev, c: String(id) }), replace: true })
  }

  const openCreate = () => {
    if (!isLg) {
      nav({ to: '/reminder/contacts/new' })
      return
    }
    nav({ search: () => ({ c: 'new' }), replace: true })
  }

  // Row-action delete: the confirm dialog and DELETE mutation live here so
  // deleting the selected contact can drop ?c in the same update (spec).
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null)
  const del = useMutation({
    mutationFn: (contact: Contact) => api(`/contacts/${contact.id}`, { method: 'DELETE' }),
    onSuccess: (_res, contact) => {
      toast.success('Contact deleted')
      setPendingDelete(null)
      if (selectedId === contact.id) nav({ search: () => ({}), replace: true })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  const showPanel = isLg && c !== undefined

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
      <div className="min-w-0 flex-1">
        {contacts.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-[420px] w-full rounded-xl" />
          </div>
        ) : contacts.isError ? (
          <p className="text-red-600">{String(contacts.error)}</p>
        ) : (
          <ContactsGrid
            contacts={contacts.data?.contacts ?? []}
            nextById={next.map}
            selectedId={selectedId}
            isLoading={next.isLoading}
            onSelect={select}
            onAdd={openCreate}
            onRequestDelete={setPendingDelete}
          />
        )}
      </div>

      {/* Docked right section (lg+ only): full detail, own scroll, fixed width.
          When ?c is absent the grid takes the full width (spec). */}
      {showPanel && (
        <aside
          aria-label="Contact detail"
          className="border-border shrink-0 overflow-hidden border-t lg:mt-0 lg:w-96 lg:border-t-0 lg:border-s xl:w-[28rem]"
        >
          <div className="h-full overflow-y-auto p-4">
            <ContactDetailContent contactId={c === 'new' ? 'new' : Number(c)} variant="docked" />
          </div>
        </aside>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All occasions and reminder preferences for this contact will be deleted too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && del.mutate(pendingDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

(If the installed Base UI `AlertDialog` root does not accept controlled `open`/`onOpenChange`, render the dialog with the plain trigger pattern inside `ActionsCell` instead — but check the primitive first: `@/components/ui/alert-dialog` wraps Base UI's dialog root, which supports both.)

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass.

- [ ] **Step 3: Manual check on the dev server (lg viewport)**

- Row click → panel opens, URL `?c=<id>`; clicking more rows replaces the same entry.
- Expand → `/reminder/contacts/<id>`; Collapse → back to `?c=<id>`; browser Back never replays selections.
- Add contact → `?c=new`, empty form; after create the panel shows the new contact, URL `?c=<id>`.
- Row action Delete on the selected contact → panel closes, `?c` dropped.
- Search filters, sorting works, pagination resets on search/sort change, column toggle shows/hides (Notes starts hidden), Next-reminder shows countdown or `—`.

- [ ] **Step 4: Manual check below lg (narrow viewport / device mode)**

- No panel; row click and Add navigate to the fullscreen routes; back returns to the list.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/reminder.contacts.index.tsx
git commit -m "feat(web): contacts master-detail page — grid + docked full-detail panel"
```

---

### Task 6: Full verification + docs

**Files:**
- Modify: `web/SHADCN.md` (document the new registry installs)

- [ ] **Step 1: Full build + backend sanity**

```bash
cd /Users/taksu/Work/code/otorem/web && pnpm build
cd /Users/taksu/Work/code/otorem && go test ./...
```

Expected: vite build succeeds (examples are tree-shaken); all Go tests pass (no backend files touched — this is a canary, not a fix point).

- [ ] **Step 2: Update `web/SHADCN.md`**

Append a bullet in the same style as the existing ones:

```markdown
- Data grid (contacts master–detail): `pnpm dlx shadcn@latest add @reui/c-data-grid-23 @reui/c-data-grid-20 --yes`
  installed `src/components/reui/data-grid/**`, `reui/frame.tsx`, `ui/input-group.tsx`, `hooks/use-copy-to-clipboard.ts`
  and dep `@tanstack/react-table` (v9 — `useTable` + `features: dataGridFeatures`, NOT the old `useReactTable`).
  The demo examples stay in `src/components/examples/` as reference with `IconPlaceholder` swapped for lucide icons
  (their `lucide="..."` hints name the icon). `ui/textarea.tsx` came from the official registry (`shadcn add textarea`).
```

- [ ] **Step 3: Run the spec's manual checklist**

From the spec's "Testing & Verification" section (10 items): create docked + fullscreen, identity edit, expand/collapse + Back semantics, <lg navigation, delete from both places, search/sort/pagination, column toggle, next-reminder countdown, Go tests. Run with `make dev` (API on :8080) + `pnpm dev` in `web/`.

- [ ] **Step 4: Commit**

```bash
git add web/SHADCN.md
git commit -m "docs(web): note data-grid registry install in SHADCN.md"
```

---

## Self-Review Notes

- **Spec coverage:** URL contract + history (Tasks 2, 3, 5), responsive behavior (Tasks 3, 5), route files (Tasks 3, 5), shared detail component with identity editing + create mode (Task 3), grid columns/toolbar/footer/empty states (Task 4), next-reminder join with 400-day window + graceful degradation (Task 4), mutations + toasts + invalidation including `['upcoming']` prefix (Tasks 3, 5), error handling: invalid `c` dropped by validator (Task 2), non-numeric `$id` redirect (Task 3), 404 state (Task 3), skeletons (Tasks 3, 5), install + adaptations (Task 1), verification incl. spec checklist + SHADCN.md (Task 6). Out-of-scope items (bulk delete, column persistence, server-side pagination, inline occasion editing) appear nowhere.
- **Type consistency:** `ContactDetailContent({ contactId: number | 'new'; variant: 'docked' | 'page' })` used identically in Tasks 3 and 5; `ContactsGrid`/`useNextReminderMap`/`ContactsSearch` signatures match between producing and consuming tasks; `initials` lives in `@/lib/initials` and is imported by both Task 3 and Task 4.
