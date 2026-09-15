# Contact Detail Revision Implementation Plan (Full-Width Left, Identity-Only Sidebar, Dropdown Delete, Per-Occasion Remind)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved revision to the contact detail page: left section always full width, edit sidebar slims to identity-only, occasions/preferences editing returns to the page as separate cards, delete moves into a ⋮ dropdown, and every occasion row gets a Remind button.

**Architecture:** The occasions/preferences form logic moves back from `ContactEditForm` into `ContactDetailContent`'s page variant (the only editing surface for them), leaving the form identity-only in all three variants. The route drops the `maxWidth` animation wrapper entirely. `ReminderTrigger` is refactored from taking a whole `UpcomingItem` to minimal payload fields plus a `compact` icon-only mode, so occasion rows can host it. Spec: `docs/superpowers/specs/2026-09-15-contact-detail-revision-full-left-identity-sidebar-design.md`.

**Tech Stack:** Unchanged — React, TanStack Router/Query, `motion/react`, lucide-react, the repo's base-ui `ui/*` wrappers. No new dependencies.

## Global Constraints

- Run all `pnpm` commands from `web/`. Verification gate per task: `pnpm exec tsc -b` (green) and `pnpm lint` (0 errors; 110 advisory warnings is the baseline).
- No frontend unit-test infra exists: per-task cycle is implement → tsc + lint → commit; the browser sweep is run by the controller at the end (Task 4).
- Exact motion values unchanged: aside tween `{ width, opacity, marginLeft }` with `{ duration: 0.25, ease: 'easeOut' }`. The page column has **no** animation of any kind (spec decision 1).
- URL contract unchanged: open edit pushes `?edit`, close replace-drops; `validateContactDetailSearch` accepts numeric `?edit=1`.
- Panel widths unchanged: edit aside inner `w-[360px] xl:w-[420px]`; create panel on contacts index untouched (`w-[280px] xl:w-[340px]`, `h-[560px]`).
- Query keys unchanged: `['contact', id]`, `['contacts']`, `['channels']`, `['settings']`, `['upcoming', …]`.
- `ReminderTrigger` backend contract: POST `/upcoming/notify` with `{ kind, occasion_id, contact_id, date, title, channel_ids }`; for `kind: 'occasion'` the server requires `occasion_id` and `contact_id` and matches `date` against occurrences of the occasion (its `base_date` qualifies).
- tsconfig has `noUnusedLocals`/`noUnusedParameters`/`verbatimModuleSyntax` — no unused imports survive a rewrite; type-only imports use `import type`.

## File Structure

- Modify: `web/src/components/event-detail.tsx` — `ReminderTrigger` props become minimal fields + `compact` + `variant`; `EventDetailBody` call site updated.
- Modify: `web/src/components/agenda-panel.tsx` — its single `ReminderTrigger` call site updated.
- Modify: `web/src/components/contacts/contact-edit-form.tsx` — slims to identity-only (all variants).
- Modify: `web/src/components/contacts/contact-detail-content.tsx` — page variant redesigned: static actions row (Edit + ⋮ dropdown holding the destructive Delete), read-only identity + notes, editable Occasions card (with per-row Remind + delete), editable Reminder Preferences card; docked variant untouched.
- Modify: `web/src/routes/reminder.contacts.$id.tsx` — remove the `motion.div` maxWidth wrapper; aside height becomes content-driven.

Task order: 1 (standalone refactor) → 2 (atomic code move: page regains editing exactly as the form loses it) → 3 (route cleanup) → 4 (controller sweep).

---

### Task 1: `ReminderTrigger` minimal-props refactor + compact mode

**Files:**
- Modify: `web/src/components/event-detail.tsx` (ReminderTrigger + EventDetailBody)
- Modify: `web/src/components/agenda-panel.tsx` (one call site)

**Interfaces:**
- Consumes: nothing new (existing `api`, `Channel`, `UpcomingItem`, `DropdownMenu*` imports).
- Produces: `ReminderTrigger({ kind, occasionId, contactId, date, title, className?, variant?, compact? })` where `kind: UpcomingItem['kind']`, `occasionId?: number`, `contactId?: number`, `date: string`, `title: string`, `variant?: React.ComponentProps<typeof Button>['variant']` (default `'default'`), `compact?: boolean` (icon-only trigger with `aria-label`). Tasks 2's occasion rows call it with `kind="occasion"`.

- [ ] **Step 1: Refactor `ReminderTrigger` in `event-detail.tsx`**

Replace the whole `ReminderTrigger` function (keep its doc comment, updated) with:

```tsx
/**
 * The manual "send the reminder now" trigger. One enabled channel → the button
 * IS the trigger; several → the button opens the channel picker, which also
 * has an "all" action. Empty channel_ids = every enabled channel. Takes the
 * minimal notify payload fields so non-Upcoming callers (an occasion row) can
 * use it too; compact renders an icon-only trigger for tight rows.
 */
export function ReminderTrigger({
  kind,
  occasionId,
  contactId,
  date,
  title,
  className,
  variant = 'default',
  compact = false,
}: {
  kind: UpcomingItem['kind']
  /** Required when kind is 'occasion'. */
  occasionId?: number
  /** Required when kind is 'occasion'. */
  contactId?: number
  date: string
  /** Holiday sends match on the title; occasions carry it for completeness. */
  title: string
  className?: string
  variant?: 'default' | 'ghost' | 'outline'
  compact?: boolean
}) {
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: Channel[] }>('/channels'),
  })
  const send = useMutation({
    mutationFn: (channelIds: number[]) =>
      api<{ sent: number; failed: number }>('/upcoming/notify', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          occasion_id: occasionId,
          contact_id: contactId,
          date,
          title,
          channel_ids: channelIds,
        }),
      }),
    onSuccess: (res) => {
      const n = `channel${res.sent === 1 ? '' : 's'}`
      if (res.failed > 0) {
        toast.warning(`Reminder sent to ${res.sent} ${n}, ${res.failed} failed.`)
      } else {
        toast.success(`Reminder sent to ${res.sent} ${n}.`)
      }
    },
    onError: (e) => toast.error(`Send failed: ${String(e)}`),
  })

  const enabledChannels = (channels.data?.channels ?? []).filter((c) => c.enabled)

  if (enabledChannels.length === 0) return null

  if (enabledChannels.length === 1) {
    return (
      <Button
        variant={variant}
        className={className}
        aria-label={compact ? `Remind now — ${title}` : undefined}
        onClick={() => send.mutate([enabledChannels[0].id])}
        disabled={send.isPending}
      >
        <SendIcon aria-hidden="true" className="size-3.5" />
        {!compact && (send.isPending ? 'Sending…' : 'Remind Now')}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            className={className}
            aria-label={compact ? `Remind now — ${title}` : undefined}
            disabled={send.isPending}
          >
            <SendIcon aria-hidden="true" className="size-3.5" />
            {!compact && (
              <>
                {send.isPending ? 'Sending…' : 'Remind Now'}
                <ChevronDownIcon aria-hidden="true" className="ms-0.5 opacity-60" />
              </>
            )}
          </Button>
        }
      />
      {/* min-w overrides the shell's min-w-32 and restores the default anchor
          width: the menu tracks the full-width trigger and only grows */}
      <DropdownMenuContent align="start" className="min-w-(--anchor-width)">
        {enabledChannels.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => send.mutate([c.id])}>
            <span className="truncate">{c.name}</span>
            <span className="text-muted-foreground ms-auto text-xs">{c.type}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => send.mutate([])}>
          <span className="font-medium">All channels</span>
          <span className="text-muted-foreground ms-auto text-xs">
            {enabledChannels.length}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Also update the `EventDetailBody` call site in the same file:

```tsx
      <ReminderTrigger
        kind={item.kind}
        occasionId={item.occasion_id}
        contactId={item.contact_id}
        date={item.date}
        title={item.title}
        className="w-full"
      />
```

Add the `React` type usage without a new import — the prop type is a plain union of the Button variants this component may need (`'default' | 'ghost' | 'outline'`), already shown in the code block, so no React import is needed.

- [ ] **Step 2: Update the `agenda-panel.tsx` call site (line ~313)**

```tsx
              <ReminderTrigger
                kind={detailItem.kind}
                occasionId={detailItem.occasion_id}
                contactId={detailItem.contact_id}
                date={detailItem.date}
                title={detailItem.title}
                className="w-full"
              />
```

(`detailItem` there is an `UpcomingItem` — same fields the old code read off `item`.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass, 0 errors / 110 advisory warnings.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/event-detail.tsx web/src/components/agenda-panel.tsx
git commit -m "refactor(reminders): ReminderTrigger takes minimal notify fields, adds compact icon mode"
```

---

### Task 2: Page variant regains occasions/preferences editing; `ContactEditForm` slims to identity-only

**Files:**
- Modify: `web/src/components/contacts/contact-edit-form.tsx` (full rewrite — atomic twin of the next file)
- Modify: `web/src/components/contacts/contact-detail-content.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ReminderTrigger` from Task 1; existing `PanelSection`, `useUpcomingByOccasion`, `DateSelectorPopover`/`dateSelectorValueToDate`/`DateSelectorValue`, `hydratePrefsForm`, ui components.
- Produces: `ContactEditForm` keeps its exact props (`{ contactId: number | 'new'; variant: 'panel' | 'page' | 'dialog'; onClose?; onSaved? }`) — no consumer changes. `ContactDetailContent` keeps `{ contactId: number; variant: 'docked' | 'page'; onEdit? }`.

- [ ] **Step 1: Rewrite `web/src/components/contacts/contact-edit-form.tsx` (identity-only)**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Minimize2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { ApiError, api, type Contact } from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

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

/** The identity edit/create surface (name, nickname, notes). Occasions and
 *  preferences are edited on the detail page, not here (revision spec). */
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
        // The read-only identity beside/behind this form must drop the stale
        // name/notes — invalidate everything identity touches.
        qc.invalidateQueries({ queryKey: ['contact', id] })
        qc.invalidateQueries({ queryKey: ['contacts'] })
        qc.invalidateQueries({ queryKey: ['upcoming'] })
        onSaved?.()
      }
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError: (e) => toast.error(`Failed to save contact: ${String(e)}`),
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

  // ============ PANEL: docked anatomy — h-11 title bar with the close
  // action, body, pinned Save/Create footer. ============
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
          ) : (
            <div className="px-4 py-4">
              {isNew && (
                <p className="text-muted-foreground mb-3 text-sm">
                  Occasions and preferences can be added on the detail page after saving.
                </p>
              )}
              <div className="space-y-3">
                {nameField}
                {nicknameField}
                {notesField}
              </div>
            </div>
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

  // ============ PAGE (/new, create only): identity header + Card. ============
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

  // ============ DIALOG: no own title bar (the Dialog supplies it), Save in
  // a footer row. ============
  return (
    <div className="text-sm">
      <div className="max-h-[60vh] min-h-0 space-y-4 overflow-y-auto">
        {errorBlock ? (
          errorBlock
        ) : loadingBlock ? (
          loadingBlock
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {nameField}
              {nicknameField}
            </div>
            {notesField}
          </div>
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

- [ ] **Step 2: Rewrite `web/src/components/contacts/contact-detail-content.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRightIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { hydratePrefsForm } from '@/lib/prefs'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { ReminderTrigger } from '@/components/event-detail'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

const TIPE: { value: string; label: string }[] = [
  { value: 'otonan', label: 'Otonan (210-day Pawukon)' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
]

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
   *  page = the detail column of /reminder/contacts/$id — identity is
   *  read-only there, occasions/preferences are edited in place. */
  variant: 'docked' | 'page'
  /** page only: renders the Edit action; the host opens the edit side
   *  section (lg) or edit dialog (below lg) — identity-only editing. */
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

  // --- occasions + preferences form state (page variant only) ---
  const [type, setType] = useState('otonan')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')
  const [offsets, setOffsets] = useState('')
  const [enabled, setEnabled] = useState(true)
  // Delete lives behind the ⋮ menu: the item opens this confirm dialog.
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  // One occasion per type: types the contact already has are disabled in the
  // type select and the Add button locks.
  const existingTypes = new Set(c.occasions.map((o) => o.type))
  const typeItems = TIPE.map((t) => ({
    label: t.label,
    value: t.value,
    disabled: existingTypes.has(t.value),
  }))

  /** Identity block: avatar above the name (+ nickname) — the subject,
   *  centered like a profile header. Notes render beneath when present.
   *  Identity is read-only here: editing lives in the side section. */
  const identityBlock = (
    <div className="flex flex-col items-center gap-2 px-4 pt-2 text-center">
      <Avatar className="size-16">
        <AvatarFallback className="text-lg">{initials(c.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
        {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
      </div>
      {c.notes && (
        <p className="text-pretty max-w-2xl whitespace-pre-wrap text-muted-foreground">{c.notes}</p>
      )}
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

  // ============ PAGE: old-editor composition — a static actions row
  // (Edit + ⋮ holding the destructive Delete), the read-only identity
  // header, then separate editable cards for Occasions and Reminder
  // Preferences (revision spec). ============
  return (
    <div className="space-y-5 text-sm">
      {/* In-flow actions row: takes layout space, so it can never paint over
          the avatar below (revision decision 4). */}
      <div className="flex items-center justify-end gap-1.5">
        {onEdit && (
          <Button size="sm" onClick={onEdit}>
            <PencilIcon aria-hidden="true" />
            Edit
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="icon-sm" aria-label="More actions">
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {identityBlock}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
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

      <Card>
        <CardHeader>
          <CardTitle>Occasions</CardTitle>
        </CardHeader>
        <CardContent>
          {c.occasions.length === 0 && (
            <p className="text-muted-foreground text-sm">No occasions yet — add the first one below.</p>
          )}
          {c.occasions.length > 0 && (
            <div className="divide-y">
              {c.occasions.map((o) => {
                const up = upcomingByOccasion.get(o.id)
                return (
                  <div key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                      <span className="truncate">{longDate(o.base_date)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {up && (
                        <Badge
                          variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                          className="shrink-0"
                        >
                          {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                        </Badge>
                      )}
                      <ReminderTrigger
                        kind="occasion"
                        occasionId={o.id}
                        contactId={c.id}
                        date={o.base_date}
                        title={`${c.name}'s ${o.type}`}
                        variant="ghost"
                        compact
                        className="size-7 justify-center px-0 text-muted-foreground hover:text-foreground"
                      />
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
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {/* flex-wrap: the two w-56 controls share the row only when there
              is room and stack on narrow viewports. */}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reminder Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Global default: {(settings.data?.default_offsets ?? []).map((n) => `D-${n}`).join(', ')} · send time {settings.data?.send_time}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="pref-offsets">Custom offsets</Label>
            <Input
              id="pref-offsets"
              value={offsets}
              onChange={(e) => setOffsets(e.target.value)}
              placeholder="e.g. 7, 4, 2, 1, 0"
              className="w-full sm:max-w-xs"
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
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass, 0 errors / 110 advisory warnings.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/contacts/contact-edit-form.tsx web/src/components/contacts/contact-detail-content.tsx
git commit -m "feat(contacts): page hosts occasions/preferences editing again; sidebar slims to identity"
```

---

### Task 3: Route cleanup — full-width column, content-height aside

**Files:**
- Modify: `web/src/routes/reminder.contacts.$id.tsx`

**Interfaces:**
- Consumes: unchanged props from both components (Task 2 kept the contracts).
- Produces: no exports; layout only.

- [ ] **Step 1: Simplify the layout**

In `ContactDetailPage`'s return, replace the whole left-column block (the `min-w-0 flex-1` div wrapping the `motion.div`):

```tsx
      {/* Detail column: always full width — no max-width animation
          (revision spec); the edit aside pushes it through flex alone. */}
      <div className="min-w-0 flex-1">
        <ContactDetailContent contactId={Number(id)} variant="page" onEdit={openEdit} />
      </div>
```

And change the aside block (keep the `isLg` gate, tween, `inert`, and children exactly as they are) to content height — replace its `className` and inner div:

```tsx
          className="hidden shrink-0 overflow-hidden rounded-xl border bg-card lg:block"
        >
          <div className="w-[360px] xl:w-[420px]">
```

i.e. drop `h-[640px]` from the aside and drop `h-full` from the inner wrapper (the identity-only form is short; the panel hugs its content). Update the aside's leading comment to say the panel height is content-driven since the form is identity-only.

Also fix the now-stale dialog copy in the same file (the edit dialog is identity-only): change the `DialogDescription` text from `Identity, occasions, and preferences — saved in place.` to `Name, nickname, and notes — saved in place.`

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass. (`motion` stays imported — the aside still uses it.)

- [ ] **Step 3: Commit**

```bash
git add web/src/routes/reminder.contacts.\$id.tsx
git commit -m "refactor(contacts): full-width detail column, content-height edit aside"
```

---

### Task 4: Verification sweep (controller-run)

**Files:**
- Modify: any file — only if the sweep finds defects; fix via one dispatched fix + scoped re-review.

**Interfaces:**
- Consumes: everything from Tasks 1–3. Produces: confidence and (if needed) fix commits.

- [ ] **Step 1: Browser sweep (controller, dev server on :5173)**

lg (1440×900): full-width detail column with sidebar closed AND open (column shrinks via flex, no animation artifacts, no centered max-w anywhere); identity header read-only with notes paragraph; Occasions card — add occasion (type + date + Add), per-row Remind (toast, 1-channel direct), per-row delete with confirm; Reminder Preferences — offsets + Save preferences → read-only docked/detail views refresh; ⋮ dropdown → Delete contact → confirm → navigates to index; Edit → identity-only slim sidebar (content height, no dead space); `?edit=1` deep link; Back closes.
Below lg (390×844): Edit → identity-only dialog; actions row never overlaps the avatar (in-flow by construction); create flows (`?c=new` lg panel, `/new` page) unchanged; dashboard/agenda Remind Now still works after the ReminderTrigger refactor.

- [ ] **Step 2: Final gate + commit any fixes**

Run: `pnpm exec tsc -b && pnpm lint`
Then (only if fixes were needed):

```bash
git add -A web/src
git commit -m "fix(contacts): revision verification-sweep fixes"
```

After the sweep, the deferred final whole-branch review runs over the finished branch (base `30e6655`).
