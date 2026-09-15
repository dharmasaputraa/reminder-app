# Contact Detail Two-Section Layout: Read-only Detail + Edit Side Section

Date: 2026-09-15
Status: approved (design discussion), pending implementation

Supersedes, where they conflict, the parts of
`2026-09-14-contacts-datagrid-master-detail-design.md` that place ALL editing
on the fullscreen detail page: editing now happens in a side section on the
detail page itself (`lg+`) or a dialog below `lg`.

## Problem

The fullscreen detail page (`/reminder/contacts/$id`, plus `/new`) is an
all-inline editor: identity, occasions, and preferences are three forms
rendered down the page. There is no read-only view of a contact at page scale,
and the edit surface does not follow the docked-side-section pattern the
dashboard and contacts index already use.

## Goal

At `lg+` the contact detail page becomes a two-section layout:

- **Left section**: the full contact detail, **read-only**, centered as a
  narrow column when no edit is active.
- **Right section** (on demand): the **edit form** in a docked side panel.
  The same form component doubles as the **create** form everywhere.
- **Below `lg`**: the side panel is replaced by a **dialog** with the same
  form (the `EventDetailDialog` contract from the dashboard).

## Decisions (from brainstorming)

- **All editing moves out of the page.** The left section is fully
  read-only (identity, notes, occasions, reminders). The side section
  (lg) / dialog (below lg) hosts the entire form: identity + occasions +
  preferences. No inline forms remain on the page.
- **One dual-mode form component used everywhere.** The new
  `ContactEditForm` (`contactId: number | 'new'`) is the single edit/create
  surface: edit side panel (lg), edit dialog (below lg), the docked create
  panel (`?c=new` on the contacts index), and the `/new` page. Navigation
  flows do not change (mobile "Add contact" still navigates to `/new`).
- **Component split over one big component.** `contact-detail-content.tsx`
  (~700 lines) becomes read-only only; all form logic moves to a new
  `contact-edit-form.tsx`.

## Components

### `ContactEditForm` (new: `web/src/components/contacts/contact-edit-form.tsx`)

Props: `contactId: number | 'new'`, `variant: 'panel' | 'page' | 'dialog'`,
plus `onClose` where the variant has its own close affordance.

All form logic moves here verbatim from the current page variant:
identity state (name/nickname/notes), occasions state (type, date selector,
pawukon preview), preferences state (offsets, enabled, channels), and the
`saveIdentity` / `addOcc` / `delOcc` / `savePrefs` mutations with their
current validation and toasts. `delContact` does NOT move — delete stays a
detail-page action on the read-only view.

- **`panel`** — docked-panel anatomy: `h-11` title bar ("Edit Contact" /
  "New Contact") with an X button calling `onClose`; scrollable body with
  hairline-separated sections (`PanelSection`); pinned footer with the
  Save / Create contact button. Mode `'new'` renders identity only (same
  content as today's docked create) so it fits the 280px create panel.
  Mode edit renders identity + Occasions (list, per-item delete, add row)
  + Preferences.
- **`page`** — used by `/new` only: centered identity header (placeholder
  avatar, "New contact"), identity Card, "occasions can be added after
  saving" note. Visually equivalent to today's `/new`.
- **`dialog`** — used inside the edit Dialog below `lg`: no own title bar
  (the Dialog supplies it); body sections + Save in `DialogFooter`.

Occasions add-row controls use `flex-wrap` with fluid widths so the type
select + date selector stack inside the 360px panel instead of
overflowing.

Post-save behavior:

- Identity save succeeds on an existing contact → toast "Contact updated",
  **panel/dialog closes** (edit param replace-dropped), left column
  refreshes via query invalidation. Preference saves do not close (they
  are sub-saves); channels autosave as today.
- Create succeeds (anywhere) → unchanged contract: replace-navigate to
  `/reminder/contacts/$id` of the new contact, toast, invalidations.

### `ContactDetailContent` (reworked: read-only only)

Props become `contactId: number` (no `'new'`), `variant: 'docked' | 'page'`,
plus optional `onEdit?: () => void`.

- **`docked`** — unchanged read-only panel (h-11 bar with maximize/close,
  identity, notes, up to 3 occasions with "see all", reminders).
- **`page`** — NEW read-only presentation replacing the editor:
  - Top-corner actions (`absolute end-0 top-0`, the current pattern):
    **Edit** button (rendered when `onEdit` is provided) + **Delete**
    (AlertDialog + `delContact` mutation, moving here from the old page
    variant; still navigates to `/reminder/contacts` after success).
  - Centered identity block, then sections inside one
    `rounded-xl border bg-card` column, hairline-separated (the panel
    anatomy at page width, no nested cards): Notes (when present),
    **all occasions** (type badge, long date, countdown badge), Reminders
    (status / offsets / channels detail rows).
  - Empty occasions → "no occasions yet" hint pointing at Edit.

### Route `/reminder/contacts/$id` (owns layout and edit state)

- `validateSearch` addition in `contacts-search.ts`: `{ edit?: boolean }`,
  following the existing validator pattern.
- **`lg+`**: flex row — left `min-w-0 flex-1` wrapping the read-only
  detail; right a `motion.aside` with the exact contacts-index tween
  (width + opacity + marginLeft, 0.25s easeOut, fixed-width inner,
  `inert` when closed), sized `w-[360px] xl:w-[420px]`, `h-[640px]`
  (wider/taller than read-only panels: the form needs the room).
- **Left column max-width behavior (the core request)**: edit closed →
  inner column `max-w-2xl` (42rem), **centered** — deliberately narrower
  than the container (`max-w-5xl` / `lg:max-w-[1400px]`). Edit open → the
  panel pushes the column from center to the left edge and the inner
  column widens to the normal two-column width — the full remaining
  section width (the `min-w-0 flex-1` behavior the other two-section
  pages use) — left-aligned. `maxWidth` is animated (motion, same 0.25s
  easeOut) so panel + push + widen read as one movement.
- **URL contract** (follows `?event` on the dashboard): opening edit
  **pushes** `?edit=1` (browser Back closes the panel); closing
  **replace-drops** the param so no stale history entry reopens it.
- **Below `lg`**: no aside. `!isLg &&` renders the edit **Dialog**
  (`sm:max-w-lg`) with `ContactEditForm variant="dialog"`. The same
  `?edit` param drives both surfaces — one source, per-breakpoint
  rendering (the `EventDetailDialog` pattern). The read-only column is
  centered `max-w-2xl` below `lg` as well.

### Collateral route changes

- **`reminder.contacts.index.tsx`** — only the panel body for `?c=new`
  swaps to `<ContactEditForm contactId="new" variant="panel" />`;
  `?c=<id>` keeps the read-only `ContactDetailContent` docked. Aside
  dimensions unchanged (create = identity only, fits 280px).
- **`reminder.contacts.new.tsx`** — renders
  `<ContactEditForm contactId="new" variant="page" />` instead of the old
  page-variant editor.

## Error handling

- Contact query error / 404: the read-only view shows the existing error
  UI; the edit panel shows a compact version of the same error in its
  body (never an empty prefill form).
- `?edit=1` deep link with an unknown id: the page shows not-found; no
  param self-healing (contact ids carry no date to infer from, unlike
  `?event`).
- No unsaved-changes guard anywhere — consistent with the app today.
- Save/prefill edge cases unchanged: Save disabled while name is empty,
  one occasion per type (existing types disabled in the select), Feb-29
  hint, pawukon preview only for `otonan`.

## Out of scope

- Sticky/floating panel behavior while the left column scrolls.
- Unsaved-changes confirmation.
- Changes to the dashboard agenda panel or the contacts grid.

## Verification

No frontend unit tests exist; the gate is `tsc -b` + `oxlint` clean, plus a
manual pass over every state: lg detail without edit / with edit / open-close
animation (both directions, interruptible), below-lg dialog, create via
`?c=new` (lg) and `/new` (below lg), delete from the read-only page,
`?edit=1` deep link, Back closes the panel, save closes the panel and
refreshes the left column, and disabled-button validation states.
