# Contact Detail: Right Sticky Identity Card + In-Column Overlay Edit

Date: 2026-09-15
Status: draft (design proposal, pending user review)

Supersedes, where they conflict, these parts of
`2026-09-15-contact-detail-revision-full-left-identity-sidebar-design.md`
and `2026-09-15-contact-detail-edit-side-section-design.md`:

- The header card (actions row + identity) lives in the LEFT column — it
  moves to a right-hand column and sticks while the left content scrolls.
- The edit surface is a docked push-aside (width/opacity/marginLeft
  collapse tween, `w-[360px] xl:w-[420px]` inner) — it becomes an overlay
  that slides over the right column, the agenda-panel detail-layer pattern.

Unchanged: the URL-owned `?edit` contract (open pushes, close
replace-drops, Back closes), the below-lg edit dialog, the identity-only
edit scope, the occasions/preferences cards and their editing, the create
flows (`?c=new` docked panel, `/new` page), and the docked variant of
`ContactDetailContent` on the contacts index.

## Decisions (from brainstorming)

1. **Two-column page at lg.** Left column (flex-1): Occasions card +
   Reminder Preferences card. Right column (fixed width): the contact
   summary card with the edit overlay docked inside it.
2. **The right column is sticky** (`lg:sticky lg:top-0`): the scrollport is
   the app shell's `<section>` (the sticky header sits outside it), so
   `top-0` pins the card just under the header while the long left content
   scrolls. No top offset needed.
3. **Edit = overlay slide-left inside the right column** (user: "seperti
   pada reminder.index.tsx" — the `AgendaPanel` detail layer): a
   `motion.div` `absolute inset-0` inside the card's `relative
   overflow-hidden` wrapper, animating `x: '100%' ↔ 0` with the same tween
   (`duration 0.28, ease [0.32, 0.72, 0, 1]`). The left column stays
   visible and interactive while editing. The old push-aside animation is
   removed; the row gap is a plain `gap-4` (no more animated
   `marginLeft`).
4. **The form stays mounted through close** (preserved behavior):
   `inert` when closed instead of unmounting, `initial={false}` so the
   first paint is already off-screen — unsaved edits survive an accidental
   close, exactly as the push-aside did.
5. **Overlay height = card height**; the edit panel (`flex h-full
   flex-col`, internal scroll — already the panel variant's anatomy)
   scrolls internally if taller. So the overlay isn't cramped on
   short cards (no notes), the card wrapper gets `min-h-[400px]` only
   while the overlay is open at lg (title bar + 3 fields + footer ≈
   395px). Closed-state card height is untouched.
6. **Mobile (below lg): the contact card moves to the top** via flex
   `order` (card `order-1`, sections `order-2`, restored at lg). Edit
   stays the below-lg dialog. The sticky/overlay machinery is lg-only.
7. **Right column width: `lg:w-[340px] xl:w-[400px]`** — between the old
   edit panel (360/420) and the agenda panel (280/340); comfortable for
   both the identity card and the edit form that fills the same column.

## Component impact

- **New `ContactSummaryCard`** (`web/src/components/contacts/contact-summary-card.tsx`):
  the moved header card. Owns the `['contact', id]` query (react-query
  dedupes with the sections' identical key — no extra fetch), the actions
  row (`[Edit] [⋮]` with the destructive dropdown item), the delete
  confirm AlertDialog + `delContact` mutation (moving out of
  `ContactDetailContent`), and the read-only identity block (centered
  avatar, name, nickname, notes). It renders content only — the card
  chrome (`rounded-xl border bg-card`) lives on the route's wrapper so
  the overlay slides within one visual card.
  Loading: identity skeleton. Error: compact "Contact not found"/"Failed
  to load contact" text (the left column keeps the full error + Back).
- **`ContactDetailContent`** (page variant): drops the header card, the
  actions row, the delete flow, and the `onEdit` prop — it becomes the
  two editable cards only. The docked variant is untouched (keeps its own
  identity block, Notes section, and Reminders section).
- **Route `/reminder/contacts/$id`**: renders the two columns and keeps
  owning the `?edit` contract:

  ```tsx
  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
    <div className="order-2 min-w-0 flex-1 lg:order-1">
      <ContactDetailContent contactId={Number(id)} variant="page" />
    </div>
    <div className="order-1 shrink-0 lg:order-2 lg:sticky lg:top-0 lg:w-[340px] xl:w-[400px]">
      <div className={cn('relative overflow-hidden rounded-xl border bg-card',
                         editOpen && 'lg:min-h-[400px]')}>
        <ContactSummaryCard contactId={Number(id)} onEdit={openEdit} />
        {isLg && (
          <motion.div inert={!editOpen} initial={false}
            animate={{ x: editOpen ? 0 : '100%' }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 z-20 flex flex-col bg-card">
            <ContactEditForm contactId={Number(id)} variant="panel"
              onClose={closeEdit} onSaved={closeEdit} />
          </motion.div>
        )}
      </div>
    </div>
  </div>
  ```

  The below-lg dialog block is unchanged. `ContactEditForm` itself needs
  no changes (panel variant already hugs an arbitrary host height).

## Behavior notes

- `?edit=1` deep link at lg: overlay renders open (no animation —
  `initial={false}`), matching the old panel.
- Crossing the lg breakpoint while editing: overlay unmounts, dialog
  mounts (same param) — identical to today's behavior.
- Delete navigates back to the index (unchanged); the ⋮ menu and confirm
  now live in the sticky card.
- While the overlay is open, the base card goes `inert` (the agenda
  panel's pattern) so Tab cannot land on the visually covered Edit/⋮
  buttons. No focus is moved programmatically; the dialog keeps Radix's
  automatic focus trap below lg.

## Revision 2 (2026-09-15, user follow-up — approved in chat)

All in `ContactSummaryCard` only; route, docked panel, and edit form untouched.

1. **Edit moves into the ⋮ dropdown.** The actions row is a single
   right-aligned ⋮ button; the menu holds an `Edit` item (pencil icon,
   calls `onEdit`) above the destructive `Delete contact` item.
   `min-w-40` kept so items stay on one line.
2. **Notes becomes a section** replacing the plain paragraph: a small
   muted "Notes" label above a `rounded-lg border` box holding the notes
   text (`whitespace-pre-wrap`), left-aligned, full card width. The box
   height matches the edit form's Notes textarea (`min-h-16`, same
   padding/border/text sizing). Empty notes render muted
   "No notes yet." with the box still shown so the height is stable.
3. **More space above the avatar**: identity block `pt-2` → `pt-8`.
4. **Bigger avatar**: `size-16` → `size-24` (initials `text-lg` →
   `text-2xl`); loading skeleton's avatar circle enlarged to match.

## Revision 3 (2026-09-15, user follow-up — approved in chat)

1. **Equal heights**: the card wrapper's `lg:min-h-[361px]` — the
   measured max of the card's (361px) and the edit form's (359px)
   natural heights — applies in BOTH states. (An earlier 400px floor
   left visible dead space below the Notes field in the edit panel;
   user revision.) Previously the card resized 361↔400 when toggling
   edit; now closed and open are both 361px. Replaces
   Revision-decision 5's "floor only while open".
2. **Menu divider**: a `DropdownMenuSeparator` between the Edit item and
   the destructive Delete contact item.
3. **Iconless menu items**: Edit and Delete contact render text only
   (Pencil/Trash icons removed from the menu; the ⋮ trigger keeps its
   icon).

## Out of scope

- Dashboard, contacts grid/index, channels, settings, create flows.
- Any change to the docked contact panel or the `?edit` contract.

## Verification

`pnpm exec tsc -b` + `pnpm lint` (0 errors), then a browser sweep at lg:
sticky card pins under the header while the left column scrolls; overlay
slides in/out covering only the right column; left column stays
interactive while open; Back closes; `?edit=1` deep link opens without
animation; unsaved edits survive close/reopen; ⋮ delete flow works from
the sticky card; short card (no notes) gets the min-height floor while
editing; below lg: card on top, dialog edit, no overlay remnants.
