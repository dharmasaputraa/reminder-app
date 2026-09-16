# Design Doc: Contact Detail Page — Tabs + Occasion Accordion

Date: 2026-09-16
Status: approved
Branch: `feature/contact-detail-tabs`

## Goals

1. The `/reminder/contacts/$id` sections column becomes one Card with two tabs:
   **Occasions** and **Reminder Preferences** (replacing the two stacked Cards).
2. Each occasion renders as an accordion item, collapsed by default, showing a
   simplified row; the per-occasion reminder editor appears only when expanded.
   Occasions that inherit defaults should read quiet; overridden ones stay findable.
3. Use the reui/base-nova primitives already matching this project (accordion,
   item, empty state) instead of custom markup; restyle the preferences form with
   the existing Field primitives.
4. The docked contact panel (right section of `/reminder/contacts`) is untouched.

Decisions from brainstorming:

- **Sortable is skipped.** The API returns occasions `ORDER BY base_date` and has
  no sort-order column; a visual-only drag would reset on reload and fight the
  chronological order. Occasions stay date-sorted.
- **Accordion is multi-open** — users tweak reminders on several occasions in one
  sitting without one snapping shut.
- **Delete and Remind-now stay always visible** on the collapsed row (outside the
  accordion trigger so buttons are never nested).
- **The add-occasion form hides behind an "Add occasion" button**; the empty
  state's CTA opens the same form.
- **Reminder Preferences keeps its behavior** (same mutations, same save
  semantics) and only gets the Field-based layout.
- Active tab is local component state — no URL param (not asked for; trivial to
  add later if deep-linking is ever needed).

## 1. Component architecture

The `page` variant of `ContactDetailContent` moves out of
`contact-detail-content.tsx` into dedicated components; the file keeps only the
`docked` variant and drops the `variant` prop.

New files in `web/src/components/contacts/`:

| File | Owns |
| --- | --- |
| `contact-detail-page-content.tsx` | The route's sections column: `contact` / `channels` / `settings` queries, loading skeleton + error/not-found UI, the Card + Tabs shell |
| `occasions-tab.tsx` | Empty state, "Add occasion" toggle, the accordion list, the delete mutation + its AlertDialog confirm |
| `add-occasion-form.tsx` | All add-form state (type select, custom-type input + suggestions, recurrence, date picker, label, pawukon preview, Feb-29 note) + the add mutation |
| `reminder-prefs-tab.tsx` | Prefs form state (yearly / monthly / enabled), channel chips, save mutation |

Data flow: `contact-detail-page-content.tsx` owns the three queries and passes
data down; each tab owns its own mutations and invalidation (same
`useQueryClient` pattern `OccasionPrefsEditor` already uses). `OccasionPrefsEditor`
is embedded unchanged in the accordion content — its write-race handling is
tested logic and must not be churned.

Modified files:

- `contact-detail-content.tsx` — docked-only; `variant` prop removed; page-only
  state (add-form state, prefs hydration, TYPE_ITEMS, RECURRENCE_ITEMS, date
  helpers for the page rows) moves to the new files.
- `routes/reminder.contacts.index.tsx` — call site drops `variant="docked"`.
- `routes/reminder.contacts.$id.tsx` — imports `ContactDetailPageContent`
  instead of `ContactDetailContent variant="page"`.

## 2. Tabs shell

One Card per the c-tabs-6 pattern: the TabsList sits in the CardHeader, the two
TabsContent panels form the body.

- Tab triggers: icon + label. Occasions: `CalendarDaysIcon` + live count
  ("Occasions (3)"); Reminder Preferences: `SlidersHorizontalIcon`.
- Count comes from `contact.data.occasions.length`, so it stays live while
  editing on the prefs tab.
- Active tab is `useState` (default `occasions`).

## 3. Occasions tab

Render order: empty state **or** add-form toggle + accordion.

- **Empty state** (`ui/empty`, calendar-icon illustration style per c-empty-20):
  "No occasions yet" + description + "Add occasion" CTA. When the form is open
  the empty state yields to the form.
- **Add occasion** — outline button (Plus icon) above the list toggles
  `AddOccasionForm` rendered in a `bg-muted/40` boxed panel. The form keeps
  today's exact fields and hints (type select with "Custom…" + suggestion chips,
  recurrence select with type-implied defaults, DateSelectorPopover, optional
  label, pawukon preview line, Feb-29 note). After a successful add the form
  stays open and the date/label fields reset (current behavior); it closes only
  via the toggle.
- **Accordion** — `type="multiple"`, no `defaultValue` (all collapsed). Each
  item follows the shadcn item-with-accordion anatomy: the `AccordionTrigger`
  wraps only the identity region; the actions are siblings of the trigger inside
  the header row (no button-in-button).
  - `ItemMedia`: per-type icon tile (`size-8`, rounded, `bg-muted`):
    birthday → cake, anniversary → heart, otonan → sparkles, custom/unknown →
    calendar.
  - `ItemTitle`: occasion type (capitalize) + optional label.
  - `ItemDescription`: short date + recurrence in human copy, e.g.
    `Wed, 18 Jun 2003 · every year`.
  - Badges inside the trigger after the text: countdown (`in 5d` / `today`,
    warning variant within 7 days), `Paused` (when `o.prefs?.enabled === false`),
    and a small `Custom` outline badge when `o.prefs != null` — so inherit items
    stay visually quiet while overrides stay findable.
  - `ItemActions` (always visible): `ReminderTrigger` (when the occasion has an
    upcoming occurrence) and Delete (ghost icon button, destructive hover, with
    the existing AlertDialog confirm — copy unchanged).
  - `AccordionContent`: `OccasionPrefsEditor` unchanged.

## 4. Reminder Preferences tab

Behavior identical to today; layout rebuilt on the existing Field primitives:

- Intro line unchanged: global defaults summary + send time.
- Yearly/Monthly offsets: two-column Field grid (`sm:grid-cols-2`), inputs
  keep ids/values/behavior, "Days before the occasion…" hint becomes
  `FieldDescription`.
- Active switch: framed row per the c-switch-8 pattern — Field label +
  description on the left, `Switch` aligned right.
- Channels: Field with the existing checkbox chips and the auto-save hint.
- Footer: "Save preferences" button bottom-right; the mutation still sends the
  non-lossy offsets spread (`{ ...c.prefs?.offsets, yearly, monthly }`) +
  `enabled`.

## 5. Component installs

The reui registry serves the `c-*` demos for free but license-gates the
underlying primitives, and tabs/switch/field already exist in this project as
the same base-nova versions. The three missing primitives are therefore written
by hand in the project idiom, keeping the exported names the design assumes:

- `ui/accordion.tsx` — wrapper over `@base-ui/react/accordion` (Root, Item,
  Header, Trigger with rotating chevron, Panel with `keepMounted` default so
  collapsed editors keep their uncontrolled inputs).
- `ui/item.tsx` — adapted from upstream shadcn `item` (MIT), `asChild` dropped
  (this codebase merges elements via Base UI `render` props).
- `ui/empty.tsx` — adapted from upstream shadcn `empty` (MIT).

`reui/badge` is not needed — the project's `ui/badge.tsx` already covers the
variants used.

## 6. Loading / errors

- Loading: one card-shaped skeleton matching the new shell (tab header bar +
  two content lines), replacing today's two-card skeleton.
- Errors: unchanged — the not-found / failed-to-load block moves into
  `contact-detail-page-content.tsx`; mutations keep toasting on failure.

## 7. Verification

1. `pnpm build` (tsc) and `pnpm lint` in `web/`.
2. Browser walkthrough of every state: collapsed rows, multi-open expansion,
   add-form open/close/add, empty state, delete confirm, prefs saves (offsets,
   active toggle, channels), tab switching.
3. Contacts index page: docked panel unchanged.
4. UI-polish pass per better-ui: no nested interactive elements inside the
   accordion trigger, chevron rotation as the only accordion motion, badges and
   icon tiles optically aligned, tabular-nums on dates.

## Non-goals

- No backend changes (no sort order, no occasion edit endpoint).
- No `OccasionPrefsEditor` restyle or logic change.
- No URL state for the active tab.
- No changes to the docked contact panel, `ContactSummaryCard`, or the edit
  overlay.
