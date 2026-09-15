# Contact Detail Two-Section Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/reminder/contacts/$id` into a two-section layout — a read-only detail column centered at `max-w-2xl` that gets pushed left and widened when a docked edit side section opens (lg+), with a dialog replacing the side section below `lg` — and move ALL contact editing/creating into one new dual-mode `ContactEditForm`.

**Architecture:** `contact-detail-content.tsx` (~700 lines, currently view + editor mixed) splits by responsibility: it keeps only the read-only presentation (docked + new page variants), while all form logic (identity, occasions, preferences, mutations) moves verbatim into a new `contact-edit-form.tsx` with `panel | page | dialog` shells. The `$id` route owns the layout and the URL-owned `?edit` state; the contacts index and `/new` swap their create surfaces to the new form. Spec: `docs/superpowers/specs/2026-09-15-contact-detail-edit-side-section-design.md`.

**Tech Stack:** React + TanStack Router (typed search), TanStack Query, `motion/react`, lucide-react, the repo's shadcn-style `ui/*` components (base-ui). No new dependencies.

## Global Constraints

- Run all `pnpm` commands from `web/`. Verification gate per task: `pnpm exec tsc -b` (green) and `pnpm lint` (clean). `tsconfig` has `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax` — no unused imports; type-only imports must use `import type`.
- No frontend unit-test infra exists. The per-task cycle is: implement → tsc + lint → (where the task renders UI) manual dev-server check → commit.
- Exact motion values, copied from the spec: the aside tween animates `width`/`opacity`/`marginLeft` with `{ duration: 0.25, ease: 'easeOut' }` (the contacts-index pattern verbatim); the left column's `maxWidth` tween uses the same `{ duration: 0.25, ease: 'easeOut' }`. Panel-content opacity swap (contacts index): `{ duration: 0.2, ease: 'easeOut' }`.
- Edit aside dims: `w-[360px] xl:w-[420px]`, `h-[640px]`. The create aside on the contacts index is NOT touched: stays `w-[280px] xl:w-[340px]`, `h-[560px]`.
- Left column: closed = 672 (px equivalent of `max-w-2xl`), open at lg = 1600 (sentinel above the widest shell, 1400px, i.e. effectively uncapped); wrapper is always `mx-auto w-full`.
- Edit URL contract: opening **pushes** `?edit` (browser Back closes); closing **replace-drops** it.
- Query keys are unchanged everywhere: `['contact', id]`, `['contacts']`, `['channels']`, `['settings']`, `['upcoming', …]`.
- Spec decisions that must survive implementation: edit save closes the panel/dialog (prefs save does not); create navigates replace to `/reminder/contacts/$id`; `delContact` stays on the read-only page (NOT in the form); no unsaved-changes guard.

## File Structure

- Modify: `web/src/lib/contacts-search.ts` — add `ContactDetailSearch` + `validateContactDetailSearch` (`{ edit?: boolean }`).
- Create: `web/src/components/contacts/contact-edit-form.tsx` — the dual-mode form (`number | 'new'`), all form logic moved from the old page variant of `contact-detail-content.tsx`.
- Modify: `web/src/components/panel-section.tsx` — `PanelSection` gains an optional `className` that replaces the default padding (the dialog needs `pt-4` because `DialogContent` already pads).
- Modify: `web/src/components/contacts/contact-detail-content.tsx` — read-only only (`contactId: number`), docked behavior unchanged, new page variant (identity + notes + ALL occasions + reminders + Edit/Delete actions).
- Modify: `web/src/routes/reminder.contacts.$id.tsx` — owns the two-section layout, the `?edit` contract, and the below-lg dialog.
- Modify: `web/src/routes/reminder.contacts.new.tsx` — renders `ContactEditForm variant="page"`.
- Modify: `web/src/routes/reminder.contacts.index.tsx` — `?c=new` panel body swaps to `ContactEditForm variant="panel"`.

Task order keeps every commit green: contract → form (unused yet) → create surfaces swap → read-only rework + route layout.

---

### Task 1: `?edit` search contract

**Files:**
- Modify: `web/src/lib/contacts-search.ts` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ContactDetailSearch { edit?: boolean }` and `function validateContactDetailSearch(search: Record<string, unknown>): ContactDetailSearch` — Task 4 wires exactly these into the `$id` route.

- [ ] **Step 1: Append the contract to `contacts-search.ts`**

```ts
/** URL search contract for /reminder/contacts/$id — the edit side section
 *  (lg) / edit dialog (below lg) is open while `edit` is present. */
export interface ContactDetailSearch {
  /** Present = the edit panel (lg) or edit dialog (below lg) is open.
   *  Open pushes (browser Back closes); close replace-drops so no stale
   *  history entry reopens it. */
  edit?: boolean
}

/** Route `validateSearch` for the contact detail page. Accepts `?edit=1`,
 *  `?edit=true`, and the bare `?edit` form. Writing undefined clears the
 *  key so the URL cleans itself up (same validator-merge note as
 *  validateContactsSearch above). */
export function validateContactDetailSearch(
  search: Record<string, unknown>
): ContactDetailSearch {
  const raw = search.edit
  const edit = raw === true || raw === '1' || raw === 'true' || raw === ''
  return { edit: edit || undefined }
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/contacts-search.ts
git commit -m "feat(contacts): add ?edit search contract for the detail page"
```

---

### Task 2: `ContactEditForm` + `PanelSection` padding hook

**Files:**
- Create: `web/src/components/contacts/contact-edit-form.tsx`
- Modify: `web/src/components/panel-section.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`, `Channel`, `Contact`, `Settings` (`@/lib/api`); `hydratePrefsForm` (`@/lib/prefs`); `DateSelectorPopover`, `dateSelectorValueToDate` (`@/components/date-selector-popover`); `DateSelectorValue` type (`@/components/reui/date-selector`); `PanelSection` (`@/components/panel-section`); the `ui/*` components listed in the imports below. All exist today.
- Produces: `function ContactEditForm(props: { contactId: number | 'new'; variant: 'panel' | 'page' | 'dialog'; onClose?: () => void; onSaved?: () => void }): JSX.Element` — Tasks 3 and 4 call it with exactly these props. `PanelSection` additionally accepts `className?: string` (replaces default padding).

- [ ] **Step 1: Give `PanelSection` a `className` that replaces the default padding**

In `web/src/components/panel-section.tsx`, replace the `PanelSection` function with:

```tsx
export function PanelSection({
  title,
  children,
  className = 'px-4 py-4',
}: {
  title: string
  children: ReactNode
  /** Replaces the default padding — the edit dialog passes "pt-4" because
   *  DialogContent already pads its content. */
  className?: string
}) {
  return (
    <section className={`border-t ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  )
}
```

(`DetailRow` below it is untouched. All existing call sites render identically — the default equals the old hardcoded value.)

- [ ] **Step 2: Create `web/src/components/contacts/contact-edit-form.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Minimize2Icon, Trash2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { hydratePrefsForm } from '@/lib/prefs'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { PanelSection } from '@/components/panel-section'
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

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (occasion rows). */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

interface ContactEditFormProps {
  /** Numeric contact id (edit), or 'new' (create). */
  contactId: number | 'new'
  /** panel = docked side section (the edit panel and the ?c=new create
   *  panel); page = the /new route (create only); dialog = below-lg edit
   *  dialog body (edit only — the Dialog owns the title bar). */
  variant: 'panel' | 'page' | 'dialog'
  /** panel only: the X button in the title bar. */
  onClose?: () => void
  /** Called after a successful identity save of an EXISTING contact — the
   *  host closes the panel/dialog. Create navigates to the detail page
   *  instead (see saveIdentity.onSuccess). */
  onSaved?: () => void
}

/** The one edit/create surface: identity + occasions + preferences, moved
 *  verbatim from the old fullscreen editor. Save model is unchanged —
 *  identity via the Save/Create button, occasions add/delete immediate,
 *  preferences via "Save preferences", channels autosave. */
export function ContactEditForm({ contactId, variant, onClose, onSaved }: ContactEditFormProps) {
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

  // --- identity form ---
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

  // --- occasions + preferences form state (edit mode only) ---
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
    // Create returns the created contact; PATCH only returns {ok:true}.
    mutationFn: (): Promise<Contact | { ok: boolean }> => {
      const body = JSON.stringify({ name: name.trim(), nickname: nickname.trim(), notes })
      return isNew
        ? api<Contact>('/contacts', { method: 'POST', body })
        : api<{ ok: boolean }>(`/contacts/${id}`, { method: 'PATCH', body })
    },
    onSuccess: (saved) => {
      const savedId = 'id' in saved ? saved.id : null
      if (isNew && savedId != null) {
        // Flow (unchanged): after create, land on the fullscreen detail page.
        // Replace so no `new` URL stays in history.
        nav({ to: '/reminder/contacts/$id', params: { id: String(savedId) }, replace: true })
        toast.success('Contact created')
        qc.invalidateQueries({ queryKey: ['contact', String(savedId)] })
      } else if (!isNew) {
        toast.success('Contact updated')
        // The read-only column showing beside/behind this form must drop the
        // stale name/notes — invalidate everything identity touches.
        invalidate()
        onSaved?.()
      }
      qc.invalidateQueries({ queryKey: ['contacts'] })
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

  // --- shared error / loading bodies (edit mode) ---
  const errorBlock = !isNew && contact.isError && (
    <div className="space-y-2">
      <p className="font-medium">
        {contact.error instanceof ApiError && contact.error.status === 404
          ? 'Contact not found'
          : 'Failed to load contact'}
      </p>
      {!(contact.error instanceof ApiError && contact.error.status === 404) && (
        <p className="text-sm text-red-600">{String(contact.error)}</p>
      )}
    </div>
  )
  const loadingBlock = !isNew && contact.isLoading && (
    <div className="space-y-2.5">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )

  // --- shared field pieces; the panel stacks them, page/dialog go 2-col ---
  const nameField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-name">Name</Label>
      <Input
        id="contact-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. Made Wijaya)"
      />
    </div>
  )
  const nicknameField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-nickname">Nickname</Label>
      <Input
        id="contact-nickname"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder="optional"
      />
    </div>
  )
  const notesField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-notes">Notes</Label>
      <Textarea
        id="contact-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="optional"
        rows={3}
      />
    </div>
  )

  const c = isNew ? undefined : contact.data
  // One occasion per type: types the contact already has are disabled in the
  // type select and the Add button locks.
  const existingTypes = new Set(c?.occasions.map((o) => o.type))
  const typeItems = TIPE.map((t) => ({
    label: t.label,
    value: t.value,
    disabled: existingTypes.has(t.value),
  }))

  const sectionPad = variant === 'dialog' ? 'pt-4' : undefined

  const occasionsSection = c && (
    <PanelSection title="Occasions" className={sectionPad}>
      {c.occasions.length === 0 && (
        <p className="text-muted-foreground">No occasions yet — add the first one below.</p>
      )}
      {c.occasions.length > 0 && (
        <div className="divide-y">
          {c.occasions.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-2.5">
                <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                <span className="truncate">{longDate(o.base_date)}</span>
              </span>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${o.type} occasion`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {o.type} on {longDate(o.base_date)} will be permanently deleted.
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
        </div>
      )}
      {/* flex-wrap: at 360px panel width the two w-56 controls share the row
          only when there is room and stack otherwise. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
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
        <p className="text-muted-foreground mt-3 text-xs">
          This contact already has this type of occasion — only one of each type is allowed.
        </p>
      )}
      {pawukon && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
      {type === 'birthday' && date.endsWith('-02-29') && (
        <p className="text-muted-foreground mt-3 text-xs">Feb 29 in non-leap years is observed on March 1.</p>
      )}
    </PanelSection>
  )

  const prefsSection = c && (
    <PanelSection title="Preferences" className={sectionPad}>
      <p className="text-muted-foreground">
        Global default: {(settings.data?.default_offsets ?? []).map((n) => `D-${n}`).join(', ')} · send time {settings.data?.send_time}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="pref-offsets">Custom offsets</Label>
        <Input
          id="pref-offsets"
          value={offsets}
          onChange={(e) => setOffsets(e.target.value)}
          placeholder="e.g. 7, 4, 2, 1, 0"
        />
        <p className="text-muted-foreground text-xs">
          Days before the occasion. Empty uses the global default.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        Active
      </label>
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Channels</div>
        <div className="flex flex-wrap gap-2">
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
        <p className="text-muted-foreground text-xs">
          Changes save automatically — no selection uses the system default channels.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => savePrefs.mutate({
            offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [],
            enabled,
          })}
        >
          Save preferences
        </Button>
      </div>
    </PanelSection>
  )

  // ============ PANEL: docked anatomy — h-11 title bar with the close
  // action, scrollable body, pinned Save/Create footer. ============
  if (variant === 'panel') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">{isNew ? 'New Contact' : 'Edit Contact'}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errorBlock ? (
            <div className="px-4 py-4">{errorBlock}</div>
          ) : loadingBlock ? (
            <div className="px-4 py-4">{loadingBlock}</div>
          ) : isNew ? (
            <div className="px-4 py-4">
              <p className="text-muted-foreground mb-3 text-sm">
                Occasions and preferences can be added on the detail page after saving.
              </p>
              <div className="space-y-3">
                {nameField}
                {nicknameField}
                {notesField}
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-4">
                <div className="space-y-3">
                  {nameField}
                  {nicknameField}
                  {notesField}
                </div>
              </div>
              {occasionsSection}
              {prefsSection}
            </>
          )}
        </div>
        <div className="border-t p-3">
          <Button
            className="w-full"
            disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
            onClick={() => saveIdentity.mutate()}
          >
            {isNew ? 'Create contact' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  // ============ PAGE (/new, create only): identity header + Card — the old
  // fullscreen create's composition. ============
  if (variant === 'page') {
    return (
      <div className="space-y-5">
        <div className="relative">
          <div className="absolute end-0 top-0 flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back to list"
              onClick={() => nav({ to: '/reminder/contacts', replace: true })}
            >
              <Minimize2Icon aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">
                <UserPlusIcon aria-hidden="true" className="size-6" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <h1 className="text-pretty text-lg leading-snug font-semibold">New contact</h1>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground -mt-2 text-center text-sm">
          Occasions and preferences can be added on the detail page after saving.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {nameField}
              {nicknameField}
            </div>
            {notesField}
            <div className="flex justify-end">
              <Button
                disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
                onClick={() => saveIdentity.mutate()}
              >
                Create contact
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============ DIALOG: no own title bar (the Dialog supplies it), sections
  // without horizontal padding (DialogContent pads), Save in a footer row. ============
  return (
    <div className="text-sm">
      <div className="max-h-[60vh] min-h-0 space-y-4 overflow-y-auto">
        {errorBlock ? (
          errorBlock
        ) : loadingBlock ? (
          loadingBlock
        ) : (
          <>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {nameField}
                {nicknameField}
              </div>
              {notesField}
            </div>
            {occasionsSection}
            {prefsSection}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
          onClick={() => saveIdentity.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass. (The component is exported but not yet rendered anywhere — that is fine for both checks.)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/contacts/contact-edit-form.tsx web/src/components/panel-section.tsx
git commit -m "feat(contacts): add dual-mode ContactEditForm (panel/page/dialog)"
```

---

### Task 3: Swap the create surfaces (`?c=new` panel, `/new` route)

**Files:**
- Modify: `web/src/routes/reminder.contacts.new.tsx` (whole file, it is 9 lines)
- Modify: `web/src/routes/reminder.contacts.index.tsx` (import + panel body only)

**Interfaces:**
- Consumes: `ContactEditForm` from Task 2 (props `contactId: 'new'`, `variant`, optional `onClose`).
- Produces: no new exports. After this task `ContactDetailContent` only ever receives numeric ids from these routes — which is what makes Task 4's `'new'` removal safe.

- [ ] **Step 1: Rewrite `web/src/routes/reminder.contacts.new.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { ContactEditForm } from '@/components/contacts/contact-edit-form'

export const Route = createFileRoute('/reminder/contacts/new')({
  component: () => <ContactEditForm contactId="new" variant="page" />,
  head: () => ({ meta: [{ title: pageTitle('New contact') }] }),
})
```

- [ ] **Step 2: Swap the `?c=new` panel body in `reminder.contacts.index.tsx`**

Add to the imports:

```tsx
import { ContactEditForm } from '@/components/contacts/contact-edit-form'
```

Replace the panel's inner block (currently a single `<ContactDetailContent contactId={panelC} variant="docked" />` inside the `motion.div`):

```tsx
            {panelC !== null && (
              <motion.div
                key={String(panelC)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="h-full overflow-y-auto"
              >
                {panelC === 'new' ? (
                  <ContactEditForm
                    contactId="new"
                    variant="panel"
                    onClose={() => nav({ to: '/reminder/contacts', replace: true })}
                  />
                ) : (
                  <ContactDetailContent contactId={panelC} variant="docked" />
                )}
              </motion.div>
            )}
```

(The `motion.div` wrapper and its tween are unchanged — only the conditional body inside is new. TS narrows `panelC` to `number` in the else branch.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass. If tsc complains about an unknown route, run `pnpm dev` for a second so the router plugin regenerates `routeTree.gen.ts`, stop it, re-run tsc. (No routes were added or removed here, so this should not trigger.)

- [ ] **Step 4: Manual check on the dev server**

Run `pnpm dev` if no dev server is running, then:

lg viewport (≥1024px):
1. `/reminder/contacts` → "Add contact" → docked panel opens (unchanged 280px width, `h-11` bar "New Contact" + X, hint text, three stacked fields, "Create contact" footer button).
2. Fill a name → "Create contact" → toast "Contact created", lands on `/reminder/contacts/<id>` (read-only at this point — Task 4 wires the rest), grid refreshed.
3. X closes the panel, URL loses `?c`.

Below lg:
4. "Add contact" navigates to `/reminder/contacts/new` → centered "New contact" page with back button, identity Card, "Create contact".

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/reminder.contacts.new.tsx web/src/routes/reminder.contacts.index.tsx
git commit -m "feat(contacts): create flows use ContactEditForm"
```

---

### Task 4: Read-only `ContactDetailContent` + two-section `$id` route

**Files:**
- Modify: `web/src/components/contacts/contact-detail-content.tsx` (full rewrite)
- Modify: `web/src/routes/reminder.contacts.$id.tsx` (full rewrite)

**Interfaces:**
- Consumes: `validateContactDetailSearch` (Task 1); `ContactEditForm` (Task 2) with `variant="panel"` + `onClose` + `onSaved`, and `variant="dialog"` + `onSaved`; `PanelSection`, `DetailRow`, `useUpcomingByOccasion` (all existing).
- Produces: `ContactDetailContent` with the narrowed props `{ contactId: number; variant: 'docked' | 'page'; onEdit?: () => void }` (the `'new'` union member is gone — only Task 3's already-swapped call sites remain).

- [ ] **Step 1: Rewrite `web/src/components/contacts/contact-detail-content.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { ChevronRightIcon, Maximize2Icon, PencilIcon, XIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { DetailRow, PanelSection } from '@/components/panel-section'
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
import { Skeleton } from '@/components/ui/skeleton'

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (page occasion rows). */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

/** Compact variant for the narrow docked panel: "Wed, 18 Jun 2003". */
function shortDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEE, d MMM yyyy')
}

interface ContactDetailContentProps {
  contactId: number
  /** docked = read-only right section of /reminder/contacts;
   *  page = read-only detail column of /reminder/contacts/$id. */
  variant: 'docked' | 'page'
  /** page only: renders the Edit action; the host opens the edit side
   *  section (lg) or edit dialog (below lg). Editing itself lives in
   *  ContactEditForm — this component is read-only by design. */
  onEdit?: () => void
}

export function ContactDetailContent({ contactId, variant, onEdit }: ContactDetailContentProps) {
  const id = String(contactId)
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  // Countdown per occasion (next occurrence inside the 400-day window) —
  // shares the grid's ['upcoming','grid'] query, no extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  const delContact = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Contact deleted')
      // The grid (and next-reminder column) must drop the deleted contact.
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      nav({ to: '/reminder/contacts', replace: true })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  if (contact.isLoading)
    return (
      <div>
        <div className="flex flex-col items-center gap-2 px-4 pt-8">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-6 space-y-2.5 border-t px-4 py-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  if (contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">{notFound ? 'Contact not found' : 'Failed to load contact'}</p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
        <Button variant="outline" size="sm" onClick={() => nav({ to: '/reminder/contacts' })}>
          Back to contacts
        </Button>
      </div>
    )
  }
  const c = contact.data!

  /** Identity block: avatar above the name (+ nickname) — the subject,
   *  centered like a profile header in both variants. */
  const identityBlock = (
    <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
      <Avatar className="size-16">
        <AvatarFallback className="text-lg">{initials(c.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
        {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
      </div>
    </div>
  )

  const notesSection = c.notes ? (
    <PanelSection title="Notes">
      <p className="text-pretty whitespace-pre-wrap">{c.notes}</p>
    </PanelSection>
  ) : null

  const remindersSection = (
    <PanelSection title="Reminders">
      <DetailRow label="Status">
        {c.prefs?.enabled === false ? (
          <Badge variant="warning-outline">Paused</Badge>
        ) : (
          <Badge variant="success-outline">Active</Badge>
        )}
      </DetailRow>
      <DetailRow label="Offsets">
        {c.prefs?.offsets?.length ? (
          <span className="flex flex-wrap justify-end gap-1">
            {[...c.prefs.offsets].sort((a, b) => b - a).map((n, i) => (
              <Badge key={`${n}-${i}`} variant="secondary">D-{n}</Badge>
            ))}
          </span>
        ) : (
          <>
            Default
            {settings.data && (
              <span className="text-muted-foreground font-normal">
                {' '}({settings.data.default_offsets.map((n) => `D-${n}`).join(', ')})
              </span>
            )}
          </>
        )}
      </DetailRow>
      <DetailRow label="Channels">
        {(() => {
          const chosen = (channels.data?.channels ?? []).filter((ch) => c.prefs?.channel_ids.includes(ch.id))
          if (chosen.length === 0) {
            // No own selection → the system default channels apply.
            const defaults = (channels.data?.channels ?? []).filter((ch) =>
              (settings.data?.default_channel_ids ?? []).includes(ch.id))
            return (
              <>
                Default
                <span className="text-muted-foreground font-normal">
                  {' '}({defaults.map((d) => d.name).join(', ') || 'all channels'})
                </span>
              </>
            )
          }
          return (
            <span className="flex flex-wrap justify-end gap-1">
              {chosen.map((ch) => (
                <Badge key={ch.id} variant="secondary">{ch.name} ({ch.type})</Badge>
              ))}
            </span>
          )
        })()}
      </DetailRow>
    </PanelSection>
  )

  // ============ DOCKED: agenda-panel anatomy — h-11 title bar with the
  // fullscreen + close actions, then read-only sections separated by
  // hairlines. Occasions cap at 3 with a see-all jump to the page. ============
  if (variant === 'docked') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">Contact</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open fullscreen detail"
              // Rendered as a real link: cmd/ctrl+click, middle-click and
              // the context menu open the fullscreen page in a new tab
              // natively (30e6655); a plain click is the Link's SPA nav.
              render={<Link to="/reminder/contacts/$id" params={{ id }} />}
            >
              <Maximize2Icon aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close panel"
              onClick={() => nav({ to: '/reminder/contacts', search: {}, replace: true })}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {identityBlock}
          {notesSection}
          <PanelSection title="Occasions">
            {c.occasions.length === 0 ? (
              <p className="text-muted-foreground">
                No occasions yet — open the fullscreen detail to add one.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {c.occasions.slice(0, 3).map((o) => {
                    const up = upcomingByOccasion.get(o.id)
                    return (
                      <div key={o.id} className="rounded-lg bg-muted/60 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-muted-foreground text-xs font-medium capitalize">
                              {o.type}
                            </p>
                            <p className="mt-0.5 text-sm font-medium tabular-nums">{shortDate(o.base_date)}</p>
                          </div>
                          {up && (
                            <Badge
                              variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                              className="shrink-0"
                            >
                              {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {c.occasions.length > 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mx-auto flex"
                    onClick={() => nav({ to: '/reminder/contacts/$id', params: { id } })}
                  >
                    See all {c.occasions.length} occasions
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </PanelSection>
          {remindersSection}
        </div>
      </div>
    )
  }

  // ============ PAGE: read-only detail card — the panel anatomy at page
  // width (hairline sections, no nested cards). Edit/Delete pinned to the
  // top-right corner over the centered identity. ============
  return (
    <div className="relative rounded-xl border bg-card text-sm">
      <div className="absolute end-4 top-4 flex items-center gap-1.5">
        {onEdit && (
          <Button size="sm" onClick={onEdit}>
            <PencilIcon aria-hidden="true" />
            Edit
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm">Delete contact</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
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
      </div>
      {identityBlock}
      {notesSection}
      <PanelSection title="Occasions">
        {c.occasions.length === 0 ? (
          <p className="text-muted-foreground">
            No occasions yet — use Edit to add the first one.
          </p>
        ) : (
          <div className="divide-y">
            {c.occasions.map((o) => {
              const up = upcomingByOccasion.get(o.id)
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                    <span className="truncate">{longDate(o.base_date)}</span>
                  </span>
                  {up && (
                    <Badge
                      variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                      className="shrink-0"
                    >
                      {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                    </Badge>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </PanelSection>
      {remindersSection}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `web/src/routes/reminder.contacts.$id.tsx`**

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { pageTitle } from '../lib/page-title'
import { validateContactDetailSearch } from '../lib/contacts-search'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'
import { ContactEditForm } from '@/components/contacts/contact-edit-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIsLg } from '@/hooks/use-lg'

export const Route = createFileRoute('/reminder/contacts/$id')({
  beforeLoad: ({ params }) => {
    // /new has its own static route; anything else non-numeric is a bad URL.
    if (!/^\d+$/.test(params.id)) throw redirect({ to: '/reminder/contacts' })
  },
  validateSearch: validateContactDetailSearch,
  component: ContactDetailPage,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

/** Read-only detail column + docked edit side section (lg) — the same
 *  two-section pattern as the dashboard and the contacts index. Below lg
 *  the side section becomes a dialog (the EventDetailDialog contract).
 *  Edit state is URL-owned: open pushes ?edit (Back closes), close
 *  replace-drops it. */
function ContactDetailPage() {
  const { id } = Route.useParams()
  const { edit } = Route.useSearch()
  const nav = Route.useNavigate()
  const isLg = useIsLg()
  const editOpen = edit === true

  /** Open edit: push, so browser Back closes the panel/dialog. */
  const openEdit = () => nav({ search: () => ({ edit: true }) })
  /** Close edit: replace-drop the param (no-op when nothing is open) so no
   *  stale history entry reopens it later. */
  const closeEdit = () => {
    if (!editOpen) return
    nav({ search: () => ({}), replace: true })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-0">
      {/* Read-only detail. Centered at max-w-2xl (672px) while no edit is
          open — deliberately narrower than the shell container — then pushed
          to the left edge and widened to the full two-column width as the
          panel opens. maxWidth tweens with the panel's own 0.25s easeOut so
          panel + push + widen read as one movement; mx-auto in both states
          keeps it centered whenever the width leaves slack (mid-tween and
          below lg). 1600 sits above the widest shell (1400px), so the open
          state is effectively uncapped — the `min-w-0 flex-1` behavior the
          other two-section pages use. */}
      <div className="min-w-0 flex-1">
        <motion.div
          initial={false}
          animate={{ maxWidth: isLg && editOpen ? 1600 : 672 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="mx-auto w-full"
        >
          <ContactDetailContent contactId={Number(id)} variant="page" onEdit={openEdit} />
        </motion.div>
      </div>

      {/* Edit side section (lg+ only): the contacts-index collapse tween
          verbatim — width + opacity + marginLeft in place, fixed-width inner
          so the panel never squishes mid-transition, lg gap on the animated
          marginLeft. The form stays mounted through the close tween (inert),
          so unsaved edits survive an accidental close. */}
      <motion.aside
        aria-label="Edit contact"
        inert={!editOpen}
        initial={false}
        animate={{
          width: editOpen ? 'auto' : 0,
          opacity: editOpen ? 1 : 0,
          marginLeft: editOpen ? 16 : 0,
        }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="hidden h-[640px] shrink-0 overflow-hidden rounded-xl border bg-card lg:block"
      >
        <div className="h-full w-[360px] xl:w-[420px]">
          <ContactEditForm
            contactId={Number(id)}
            variant="panel"
            onClose={closeEdit}
            onSaved={closeEdit}
          />
        </div>
      </motion.aside>

      {/* Below lg the side section doesn't exist — the dialog replaces it.
          The same ?edit param drives both surfaces. */}
      {!isLg && (
        <Dialog open={editOpen} onOpenChange={(open) => { if (!open) closeEdit() }}>
          {editOpen && (
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-left">Edit contact</DialogTitle>
                <DialogDescription className="text-left">
                  Identity, occasions, and preferences — saved in place.
                </DialogDescription>
              </DialogHeader>
              <ContactEditForm contactId={Number(id)} variant="dialog" onSaved={closeEdit} />
            </DialogContent>
          )}
        </Dialog>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass. (No route was added/removed, so `routeTree.gen.ts` needs no regeneration; `validateSearch` typing is inferred from the inline route config.)

- [ ] **Step 4: Manual check on the dev server — lg (≥1024px viewport)**

On `/reminder/contacts/1` (any existing contact id):

1. Page loads read-only: bordered card centered at `max-w-2xl`, avatar + name top-center, Edit + Delete top-right, Notes (if any), full Occasions list with countdown badges, Reminders rows. No forms anywhere.
2. Click **Edit** → side panel slides in from the right while the card pushes left and widens — one continuous movement, no jump; panel is `360px` wide (420px ≥1280px), `640px` tall, titled "Edit Contact" with X; form prefilled.
3. Change the name → **Save** → toast "Contact updated", panel closes, card re-centers and shows the new name (no reload).
4. **X** closes the panel with the same tween; browser **Back** also closes it when open; `?edit=1` deep link opens the panel directly on load.
5. Occasions: add one (type + date → **Add**) → appears in the left card's list immediately; delete one → confirm → gone from both surfaces.
6. Preferences: change offsets → **Save preferences** → panel STAYS open, toast confirms; tick a channel → saves instantly.
7. Empty the name → Save disables. Restore it.
8. **Delete contact** → confirm → toast, back on `/reminder/contacts`.

- [ ] **Step 5: Manual check — below lg (<1024px viewport)**

1. Same page: read-only card centered at `max-w-2xl`, no aside at any state.
2. **Edit** → Dialog (`max-w-lg`): title "Edit contact", same sections, Save in the footer. Save with a change → dialog closes, card shows the update. X / outside click / Esc → closes, URL clean.
3. Resize up to lg while the dialog is open → dialog disappears, panel takes over (same `?edit` param).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/contacts/contact-detail-content.tsx web/src/routes/reminder.contacts.\$id.tsx
git commit -m "feat(contacts): two-section detail page — read-only column + edit side section"
```

---

### Task 5: Full verification sweep

**Files:**
- Modify: any file — only if the sweep finds defects; fix and re-verify.

**Interfaces:**
- Consumes: everything shipped in Tasks 1–4.
- Produces: confidence + (if needed) polish commits. No new interfaces.

- [ ] **Step 1: Cross-surface sweep (lg + below lg, fresh reload per flow)**

1. Create → edit chain: `/reminder/contacts` → Add contact (lg: docked create; below lg: `/new`) → create "Test User" → detail page → Edit → add a Birthday occasion → Save → occasion visible read-only → Delete the occasion from the edit panel → Save preferences with offsets `7, 3` → read-only shows D-7, D-3.
2. Delete chain: delete "Test User" from its detail page → lands on the grid, row gone, no `?c` stale state.
3. Dashboard regression: `/reminder/` calendar + agenda panel still behave (upcoming names refresh after contact edits — `['upcoming']` invalidation).
4. History contract: with edit open, Back closes the panel and a second Back leaves the detail page; closing via X then Back leaves the page directly (no double-Back from a dropped param).
5. Interruptible motion: click Edit then X immediately, repeatedly — panel never sticks half-open; rapid Edit toggles don't strand `?edit` in the URL.
6. 404: `/reminder/contacts/999999` → "Contact not found" + Back to contacts; `?edit=1` on that URL shows the same compact error inside the panel body, no empty form.

- [ ] **Step 2: UI-polish pass (better-ui gate)**

Check per `better-ui`: both tweens use exactly `0.25`/`easeOut` and only the named properties (no `transition: all` anywhere new); panel and card share `rounded-xl` and the shell's border treatment (concentric radii — no nested rounded boxes inside the detail card); Edit/Delete buttons keep their hit areas (`size="sm"`, ≥ the app's standard); icons `aria-hidden` with labeled buttons; `inert` on the closed aside (keyboard cannot reach the hidden form).

- [ ] **Step 3: Final gate**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(contacts): verification-sweep fixes for the two-section detail page"
```

(Skip if the sweep found nothing.)
