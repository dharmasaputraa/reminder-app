# Contact Detail: Right Sticky Identity Card + In-Column Overlay Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the contact detail page into two columns — editable sections left, sticky contact summary card right — and replace the push-aside edit panel with an overlay that slides left over the right column (the agenda-panel detail-layer pattern), with the card stacked on top below lg.

**Architecture:** The header card moves out of `ContactDetailContent`'s page variant into a new `ContactSummaryCard` that owns the same `['contact', id]` query (react-query dedupes — no extra fetch) plus the ⋮ delete flow. The route renders the two columns, makes the right one `lg:sticky lg:top-0`, and hosts the edit overlay (`motion.div` `absolute inset-0`, `x: '100%' ↔ 0`) inside the card's `relative overflow-hidden` wrapper. Spec: `docs/superpowers/specs/2026-09-15-contact-detail-right-sticky-card-overlay-edit-design.md`.

**Tech Stack:** Unchanged — React, TanStack Router/Query, `motion/react`, lucide-react, the repo's base-ui `ui/*` wrappers. No new dependencies.

## Global Constraints

- Run all `pnpm` commands from `web/`. Verification gate per task: `pnpm exec tsc -b` (green) and `pnpm lint` (0 errors; advisory warnings at the current baseline).
- No frontend unit-test infra exists: per-task cycle is implement → tsc + lint → commit; the browser sweep is run by the controller at the end (Task 3).
- Exact motion values (agenda detail-layer verbatim): `animate={{ x: editOpen ? 0 : '100%' }}`, `transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}`, `initial={false}`. No width/opacity/marginLeft animation anywhere — the old push-aside tween is deleted.
- URL contract unchanged: open edit pushes `?edit`, close replace-drops; `validateContactDetailSearch` accepts numeric `?edit=1`; the `beforeLoad` numeric-id guard is untouched.
- Column width: right column `lg:w-[340px] xl:w-[400px]`; while the overlay is open the card wrapper also gets `lg:min-h-[400px]` (closed-state height untouched).
- Query keys unchanged: `['contact', id]`, `['contacts']`, `['channels']`, `['settings']`, `['upcoming', …]`.
- Untouched: the docked variant of `ContactDetailContent`, `ContactEditForm` (all variants), the below-lg Dialog, and the create flows (`?c=new` panel, `/new` page).
- tsconfig has `noUnusedLocals`/`noUnusedParameters`/`verbatimModuleSyntax` — no unused imports survive a rewrite; type-only imports use `import type`.

## File Structure

- Create: `web/src/components/contacts/contact-summary-card.tsx` — the moved header card: actions row (`[Edit] [⋮]` destructive dropdown), read-only identity block (avatar, name, nickname, notes), delete confirm + `delContact` mutation, own `['contact', id]` query. Content only (no card chrome — the host supplies it so the overlay slides within one visual card).
- Modify: `web/src/routes/reminder.contacts.$id.tsx` — full rewrite: two-column flex (mobile order: card first), sticky right column, edit overlay inside the card wrapper, below-lg Dialog unchanged.
- Modify: `web/src/components/contacts/contact-detail-content.tsx` — page variant trims to the Occasions + Reminder Preferences cards; header card, actions row, delete flow, and the `onEdit` prop move out; loading skeleton becomes variant-aware; `identityBlock` becomes docked-only. Docked variant untouched.

Task order: 1 (new component, not yet mounted) → 2 (atomic switch: route rewires AND page variant trims in one commit — never two header cards, never none) → 3 (controller sweep).

---

### Task 1: New `ContactSummaryCard` component

**Files:**
- Create: `web/src/components/contacts/contact-summary-card.tsx`

**Interfaces:**
- Consumes: existing `api`, `Contact`, `ApiError`, `initials`, `AlertDialog*`, `Button`, `DropdownMenu*`, `Avatar`, `Skeleton` (all already used elsewhere in `contacts/`).
- Produces: `ContactSummaryCard({ contactId, onEdit })` where `contactId: number`, `onEdit?: () => void`. Renders content only — the host wraps it in the card chrome. Task 2's route mounts it with `contactId={Number(id)} onEdit={openEdit}`.

- [ ] **Step 1: Create the component**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { ApiError, api, type Contact } from '@/lib/api'
import { initials } from '@/lib/initials'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'

interface ContactSummaryCardProps {
  contactId: number
  /** Renders the Edit action; the host opens the edit overlay (lg) or the
   *  edit dialog (below lg) — identity-only editing. */
  onEdit?: () => void
}

/** The right-hand sticky summary card of the detail page: the actions row
 *  (Edit + ⋮ holding the destructive delete) above the read-only identity
 *  block (avatar, name, nickname, notes). Content only — the host supplies
 *  the card chrome so the edit overlay can slide within one visual card.
 *  Shares the ['contact', id] query key with the sections column
 *  (ContactDetailContent); react-query serves both from one fetch. */
export function ContactSummaryCard({ contactId, onEdit }: ContactSummaryCardProps) {
  const id = String(contactId)
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
  })
  // Delete lives behind the ⋮ menu: the item opens this confirm dialog.
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
    )
  if (contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    // Compact on purpose: the sections column renders the full error state
    // with the Back button; this card never duplicates it.
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">
          {notFound ? 'Contact not found' : 'Failed to load contact'}
        </p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
      </div>
    )
  }
  const c = contact.data!

  return (
    <>
      {/* In-flow actions row: takes layout space, so it can never paint over
          the avatar below. */}
      <div className="flex items-center justify-end gap-1.5 px-4 pt-4">
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
          {/* min-w-40: the menu tracks its 28px icon anchor by default,
              which wraps "Delete contact" onto two lines. */}
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Identity block: avatar above the name (+ nickname) — centered like a
          profile header; notes render beneath when present. Read-only:
          editing lives in the overlay (lg) / dialog (below lg). */}
      <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-2 text-center">
        <Avatar className="size-16">
          <AvatarFallback className="text-lg">{initials(c.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-1">
          <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
          {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
        </div>
        {c.notes && (
          <p className="text-pretty max-w-2xl whitespace-pre-wrap text-muted-foreground">
            {c.notes}
          </p>
        )}
      </div>

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
    </>
  )
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass, 0 errors. (The component is unused until Task 2 — an unused module compiles fine.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/contacts/contact-summary-card.tsx
git commit -m "feat(contacts): ContactSummaryCard — actions row + read-only identity for the sticky right column"
```

---

### Task 2: Route two-column layout + edit overlay; page variant trims to sections (atomic switch)

**Files:**
- Modify: `web/src/routes/reminder.contacts.$id.tsx` (full rewrite)
- Modify: `web/src/components/contacts/contact-detail-content.tsx` (surgical edits, exact hunks below)

**Interfaces:**
- Consumes: `ContactSummaryCard` from Task 1; `ContactEditForm` (props unchanged); `useIsLg`, `cn`, `motion`.
- Produces: `ContactDetailContent` props become `{ contactId: number; variant: 'docked' | 'page' }` — `onEdit` is REMOVED (the route no longer passes it; the contacts index passes neither). No other exports.

- [ ] **Step 1: Rewrite `web/src/routes/reminder.contacts.$id.tsx`**

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { pageTitle } from '../lib/page-title'
import { validateContactDetailSearch } from '../lib/contacts-search'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'
import { ContactEditForm } from '@/components/contacts/contact-edit-form'
import { ContactSummaryCard } from '@/components/contacts/contact-summary-card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIsLg } from '@/hooks/use-lg'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/reminder/contacts/$id')({
  beforeLoad: ({ params }) => {
    // /new has its own static route; anything else non-numeric is a bad URL.
    if (!/^\d+$/.test(params.id)) throw redirect({ to: '/reminder/contacts' })
  },
  validateSearch: validateContactDetailSearch,
  component: ContactDetailPage,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

/** Editable sections column + sticky right identity card with the edit
 *  overlay docked inside it (lg) — the agenda-panel detail-layer pattern:
 *  the overlay sweeps in from the column's right edge covering the card,
 *  and the sections column stays visible and interactive. Below lg the
 *  card stacks on top (flex order) and the dialog replaces the overlay.
 *  Edit state is URL-owned: open pushes ?edit (Back closes), close
 *  replace-drops it. The form stays mounted through close (inert), so
 *  unsaved edits survive an accidental close. */
function ContactDetailPage() {
  const { id } = Route.useParams()
  const { edit } = Route.useSearch()
  const nav = Route.useNavigate()
  const isLg = useIsLg()
  const editOpen = edit === true

  /** Open edit: push, so browser Back closes the overlay/dialog. */
  const openEdit = () => nav({ search: () => ({ edit: true }) })
  /** Close edit: replace-drop the param (no-op when nothing is open) so no
   *  stale history entry reopens it later. */
  const closeEdit = () => {
    if (!editOpen) return
    nav({ search: () => ({}), replace: true })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Sections column: occasions + preferences — the long content the
          identity card sticks alongside. Order flips it below the card on
          mobile and back to the left at lg. */}
      <div className="order-2 min-w-0 flex-1 lg:order-1">
        <ContactDetailContent contactId={Number(id)} variant="page" />
      </div>

      {/* Sticky identity column: the summary card is the base layer of one
          visual card; the edit overlay is absolute inset-0 within it. The
          base layer goes inert while covered so Tab can't land on the
          hidden Edit/⋮ buttons (the agenda panel's pattern). The min-h
          floor while open keeps the 3-field form from being cramped inside
          a short (notes-less) card. The overlay is lg-only; below lg the
          dialog replaces it (same ?edit param). */}
      <div className="order-1 shrink-0 lg:order-2 lg:sticky lg:top-0 lg:w-[340px] xl:w-[400px]">
        <div
          className={cn(
            'relative overflow-hidden rounded-xl border bg-card',
            editOpen && 'lg:min-h-[400px]',
          )}
        >
          <div inert={editOpen}>
            <ContactSummaryCard contactId={Number(id)} onEdit={openEdit} />
          </div>
          {isLg && (
            <motion.div
              aria-label="Edit contact"
              inert={!editOpen}
              initial={false}
              animate={{ x: editOpen ? 0 : '100%' }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 z-20 flex flex-col bg-card"
            >
              <ContactEditForm
                contactId={Number(id)}
                variant="panel"
                onClose={closeEdit}
                onSaved={closeEdit}
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* Below lg the overlay doesn't exist — the dialog replaces it. The
          same ?edit param drives both surfaces. */}
      {!isLg && (
        <Dialog open={editOpen} onOpenChange={(open) => { if (!open) closeEdit() }}>
          {editOpen && (
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-left">Edit contact</DialogTitle>
                <DialogDescription className="text-left">
                  Name, nickname, and notes — saved in place.
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

- [ ] **Step 2: Trim `contact-detail-content.tsx` — exact hunks**

Hunk A — the props interface and signature. Replace:

```tsx
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
```

with:

```tsx
interface ContactDetailContentProps {
  contactId: number
  /** docked = read-only right section of /reminder/contacts;
   *  page = the editable sections column of /reminder/contacts/$id —
   *  occasions/preferences are edited in place; identity + actions live
   *  in the sticky ContactSummaryCard beside this column. */
  variant: 'docked' | 'page'
}

export function ContactDetailContent({ contactId, variant }: ContactDetailContentProps) {
```

Hunk B — delete the whole `delContact` mutation block (from `const delContact = useMutation({` through its closing `})`) and the two lines:

```tsx
  // Delete lives behind the ⋮ menu: the item opens this confirm dialog.
  const [confirmDelete, setConfirmDelete] = useState(false)
```

(`useNavigate`/`nav` stays — the docked variant and the error branch use it; `toast` stays for the remaining mutations.)

Hunk C — make the loading branch variant-aware. Replace the current `if (contact.isLoading) return ( …identity+list skeletons… )` with:

```tsx
  if (contact.isLoading)
    return variant === 'docked' ? (
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
    ) : (
      // Page: two section-card skeletons — identity has its own card now.
      <div className="space-y-5">
        <div className="rounded-xl border bg-card">
          <div className="px-4 pt-4">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-2.5 px-4 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="rounded-xl border bg-card">
          <div className="px-4 pt-4">
            <Skeleton className="h-5 w-44" />
          </div>
          <div className="space-y-2.5 px-4 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    )
```

Hunk D — `identityBlock` becomes docked-only (drop the `variant === 'page'` ternary classes and the page-only notes paragraph — the docked panel renders notes via its own Notes section). Replace the whole `identityBlock` definition with:

```tsx
  /** Identity block (docked panel only): avatar above the name (+ nickname)
   *  — the centered profile header. The page variant has no identity block
   *  here; it lives in the sticky ContactSummaryCard. */
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
```

Hunk E — the page return. Replace the whole header portion of the page return (the comment block, the actions-row div with the Edit button and ⋮ DropdownMenu, the `{identityBlock}` line, and the page-level `<AlertDialog open={confirmDelete} …>…</AlertDialog>`) so the page return starts directly with the Occasions card:

```tsx
  // ============ PAGE: the editable sections column — Occasions and
  // Reminder Preferences cards. Identity + the Edit/⋮ actions live in the
  // sticky ContactSummaryCard beside this column (route-level). ============
  return (
    <div className="space-y-5 text-sm">
      <Card>
```

Keep BOTH existing `<Card>` blocks (Occasions and Reminder Preferences) exactly as they are, byte for byte.

Hunk F — imports. From the lucide import list remove `MoreHorizontalIcon` and `PencilIcon` (only the actions row used them); delete the whole `DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger` import block (only the ⋮ menu used it). Keep `AlertDialog*` (occasion rows), `Trash2Icon` (occasion rows), `Avatar`, `Skeleton`, everything else.

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: pass, 0 errors. (`noUnusedLocals` proves Hunk F caught everything.)

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/reminder.contacts.\$id.tsx web/src/components/contacts/contact-detail-content.tsx
git commit -m "feat(contacts): two-column detail page — sticky identity card right, overlay slide-left edit"
```

---

### Task 3: Verification sweep (controller-run)

**Files:**
- Modify: any file — only if the sweep finds defects; fix + scoped re-verify, then commit.

**Interfaces:**
- Consumes: everything from Tasks 1–2. Produces: confidence and (if needed) fix commits.

- [ ] **Step 1: Browser sweep (controller, dev server on :5173)**

lg (1440×900): two columns with the card right and sections left; scroll the left column — the card pins just under the header (`lg:top-0`) and stays put; Edit → overlay slides in from the column's right edge covering only the card (left column readable AND clickable throughout); type into Notes, close (X or Back), reopen → the draft is still there; `?edit=1` deep link renders open with no animation; Save → overlay closes, card + docked surfaces refresh name/notes; ⋮ → Delete contact → confirm → navigates to index; add/delete an occasion and save preferences still work in the left column; short card (clear the notes) → while editing, the wrapper holds the 400px floor and the form isn't cramped; overlay's internal scroll never fights the page scroll.
Below lg (390×844): card stacks on TOP, then Occasions, then Reminder Preferences; Edit opens the dialog; no overlay remnants off-screen; resize across the lg breakpoint while editing swaps overlay ↔ dialog without stuck state.
Regression: contacts index docked panel unchanged (identity, Notes, Reminders sections, cap-at-3 occasions); `?c=new` panel and `/new` page unchanged; dashboard unaffected.

- [ ] **Step 2: Visual gate**

Render the touched states (lg closed/open overlay, lg scrolled sticky, below-lg stacked, loading skeleton) to PNGs and run the judge pass per the delivery protocol; act on any fail verdicts.

- [ ] **Step 3: Final gate + commit any fixes**

Run: `pnpm exec tsc -b && pnpm lint`
Then (only if fixes were needed):

```bash
git add -A web/src
git commit -m "fix(contacts): sticky-card overlay verification-sweep fixes"
```
