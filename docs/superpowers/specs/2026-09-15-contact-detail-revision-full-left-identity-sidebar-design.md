# Contact Detail Revision: Full-Width Left, Identity-Only Sidebar, Dropdown Delete, Per-Occasion Remind

Date: 2026-09-15
Status: approved (design discussion), pending implementation

Supersedes, where they conflict, these parts of
`2026-09-15-contact-detail-edit-side-section-design.md`:

- "The left section is fully read-only" — occasions and preferences editing
  moves BACK to the page; only identity editing stays in the side section.
- The centered narrow left column (`max-w-2xl` ↔ widened, animated) — the
  left section is now always full width.
- The read-only page presentation (single bordered card, hairline sections,
  pinned absolute Edit/Delete) — the page returns to the old editor's
  separate-cards composition with a new static actions row.

Unchanged from the earlier spec: the URL-owned `?edit` contract (open
pushes, close replace-drops, Back closes), the docked aside tween and
`w-[360px] xl:w-[420px]` widths, the below-lg dialog, the create flows
(`?c=new` docked panel, `/new` page), and the component split
(`ContactDetailContent` vs `ContactEditForm`).

## Decisions (from brainstorming)

1. **Left section always full width.** No centered max-width, no maxWidth
   animation — the `motion.div` wrapper is removed from the route. The
   column is a plain `min-w-0 flex-1`; the edit aside still pushes it left
   naturally through the flex row.
2. **Edit sidebar is identity-only.** It edits Name, Nickname, and Notes
   only. Occasions and Reminder Preferences editing lives on the left
   section again.
3. **Delete goes into a dropdown** so it cannot be triggered casually: the
   actions row is `[Edit] [⋮]`; the ⋮ `DropdownMenu` holds one destructive
   item, "Delete contact", which still opens the existing confirmation
   AlertDialog.
4. **The actions row takes layout space.** It is a static in-flow row
   (right-aligned, `pb-4`) at the top of the page content — not an absolute
   overlay — so it can never paint over the avatar (this retires the
   `pt-14 sm:pt-6` workaround from `caac649`).
5. **A Remind button per occasion row**, reusing the existing
   `ReminderTrigger` (POST `/upcoming/notify`): one enabled channel → sends
   immediately; several → the channel-picker dropdown; toast reports
   sent/failed.

## Page structure (left section, page variant)

Old-editor composition, minus inline identity editing, wrapped in ONE card
(user follow-up to the original separate-cards decision: everything sits
inside a single `rounded-xl border bg-card` with PanelSection hairlines —
no nested cards):

- **Actions row**: right-aligned in-flow `[Edit] [⋮]` at the card's top.
- **Identity header** (read-only): centered avatar, name, nickname; notes
  rendered as a read-only paragraph beneath when present.
- **Section: Occasions** — one row per occasion:
  `[type badge] [long date] [countdown badge] [Remind] [delete]`; the add
  row (type select + date selector + Add) and the one-per-type /
  pawukon-preview / Feb-29 hints return verbatim from the old editor.
- **Section: Reminder Preferences** — verbatim from the old editor: global
  default line, custom offsets input, Active switch, channel checkboxes
  (autosave), "Save preferences".

The read-only "Reminders" summary section (status/offsets/channels) is
dropped from the page — redundant with the editable preferences card. The
docked panel on the contacts index keeps it.

## Component impact

- **`ContactDetailContent`** (page variant): regains the occasions and
  preferences state + mutations (`addOcc`, `delOcc`, `savePrefs`, pawukon
  preview, `TIPE`, date selector), moved back from `ContactEditForm` — only
  the page variant edits; the docked variant stays read-only. Also gains
  the actions row with the ⋮ dropdown wrapping the existing `delContact`
  confirm flow, and the per-occasion Remind buttons.
- **`ContactEditForm`**: slims to identity-only in all three variants
  (panel / page / dialog). `onSaved` / `onClose` / post-create navigation
  behavior unchanged. The create surfaces (`?c=new`, `/new`) are already
  identity-only — no visible change there.
- **Route `/reminder/contacts/$id`**: `motion.div` maxWidth wrapper removed;
  the edit aside switches from fixed `h-[640px]` to content height
  (`h-fit`, `self-start` already on the row) since the form is short.
- **`ReminderTrigger`** (`event-detail.tsx`): small prop refactor so it
  accepts the minimal payload fields (kind, occasion_id, contact_id, date,
  title) instead of a whole `UpcomingItem` — existing dashboard callers
  keep working. The backend requires `occasion_id`, `contact_id`, and a
  date that EXACTLY matches a computed occurrence of the occasion (see
  `internal/api/upcomingnotify.go`): for `otonan` the base date itself is
  NOT an occurrence (occurrences are base + 210n), so the row's trigger
  passes the next occurrence date from the upcoming map
  (`up.date`) and renders only when that occurrence is known.

## Out of scope

- Everything not listed above: dashboard, contacts grid, channels, settings.
- The `?edit` contract and panel/dialog switching mechanics.

## Verification

Gate unchanged: `pnpm exec tsc -b` + `pnpm lint` (0 errors), then a browser
sweep over every touched state: full-width layout with the sidebar open and
closed, add/delete occasion, Remind per occasion (toast), preferences save,
dropdown delete flow, slim sidebar at lg, identity-only dialog below lg,
create flows, `?edit=1` deep link, and the narrow-viewport actions row (no
overlay possible). After the revision lands, the deferred final
whole-branch review runs over the finished branch.
