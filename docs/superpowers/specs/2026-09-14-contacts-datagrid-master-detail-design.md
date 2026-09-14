# Contacts Data Grid + Master–Detail CRUD (reui)

Date: 2026-09-14
Status: approved (design discussion), pending implementation

## Problem

The contacts page is a bare card list with an add-by-name form:

- Name/nickname/notes cannot be edited anywhere, although the backend already
  supports `PATCH /contacts/:id` with all three fields.
- The list has no search, sort, filter, or pagination.
- Deleting a contact requires opening its detail page.
- The add flow is a single input with no feedback and no room for nickname/
  notes.
- The detail page is all-or-nothing: you leave the list to see one contact.

## Goal

A master–detail contacts page: a searchable, sortable, paginated data grid on
the left (reui data-grid primitives), the full contact detail docked in a right
section on `lg+`, and plain page navigation below `lg`. Create reuses the same
docked panel as an empty form. CRUD flows become consistent, and every view
state is reflected in the URL.

## Decisions (from brainstorming)

- reui data-grid is adopted; the project already uses the `@reui` registry
  (`base-nova` style) for the event calendar and date selector.
- Master–detail is route-based (Approach A), not a Sheet overlay.
- The right section hosts the **full detail** (identity form, occasions,
  preferences) — the same component as the fullscreen page, only narrower.
- Create opens the panel as an **empty contact form** (no mini dialog). After
  saving it becomes the selected contact.
- Delete is available from the panel **and** a grid row action. No bulk
  selection / bulk delete.
- Grid columns: Name (avatar + nickname), Next reminder (countdown), Occasions
  (badges), Status (Active/Paused), Notes (indicator, hidden by default),
  row Actions. Column visibility is toggleable (`c-data-grid-20` pattern).
- Zero backend changes: `POST /contacts` already accepts
  `{name, nickname, notes}` and returns the created contact; `PATCH` already
  supports identity edits; `/upcoming` already supports a 400-day window with
  `contact_id` in each item.

## URL Contract

| State | URL | Reachable |
|---|---|---|
| Grid only, nothing selected | `/reminder/contacts` | lg+, initial |
| Grid + docked detail | `/reminder/contacts?c=123` | lg+, row click |
| Grid + docked create form | `/reminder/contacts?c=new` | lg+, "Add contact" |
| Fullscreen detail | `/reminder/contacts/123` | Expand button; <lg row click |
| Fullscreen create | `/reminder/contacts/new` | Expand during create; <lg Add |

- `c` is validated by `validateSearch`: numeric string or `new`; anything else
  is dropped (panel simply not rendered).
- `/reminder/contacts/new` is a static route that outranks `$id`; the `$id`
  route redirects non-numeric ids to the list.

### History behavior

- Row selection (changing `c`) → **replace**. Browsing 10 contacts leaves one
  history entry; Back leaves the page instead of replaying selections.
- Expand (docked → fullscreen) → **push**; Back returns to the docked view.
- Collapse (fullscreen → docked) → **replace**, so Back never re-opens a
  closed fullscreen view (same rationale as the reminder-calendar spec).
- The Add button opening `?c=new` → replace (toolbar action, lg+); on <lg
  the Add button navigates to `/new` as ordinary push navigation. Expanding
  a docked create form follows the normal Expand rule (push).
- After create succeeds: fullscreen `/new` → **replace** to
  `/reminder/contacts/<id>`; docked `?c=new` → **replace** to `?c=<id>`.
- After deleting the selected contact: docked drops `c` (replace); fullscreen
  navigates back to the list.

## Responsive Behavior

Detection: `matchMedia('(min-width: 1024px)')` — extend the existing
`hooks/use-mobile.ts` rather than adding a second hook file.

- **lg+**: grid (`flex-1 min-w-0`) and, when `c` is set, a fixed-width right
  section (`lg:w-96 xl:w-[28rem]`, own scroll, left border). The grid stays
  visible and interactive. Panel header carries Expand (Maximize2 icon);
  the fullscreen page carries Collapse (Minimize2 icon) back to `?c=id`.
- **<lg**: no panel. Rows and the Add button navigate to the fullscreen routes
  (current behavior). The page-level Back button returns to the list.

## Route Files

- `routes/reminder.contacts.index.tsx` — rewritten: `validateSearch` (`c?`),
  composes `ContactsGrid` + docked `ContactDetailContent`.
- `routes/reminder.contacts.$id.tsx` — slimmed: fetch contact by id, render
  `ContactDetailContent` with `variant="page"`.
- `routes/reminder.contacts.new.tsx` — new: renders the create form with
  `variant="page"`.

## Components

### `components/contacts/contact-detail-content.tsx`

Shared detail surface. Props: `contactId: number | 'new'`,
`variant: 'docked' | 'page'`. Variant only changes the header actions
(Expand/Collapse vs. nothing extra) and heading size.

- **Identity form**: Name (required), Nickname, Notes (Textarea). Explicit
  Save button ("Create contact" in create mode), dirty-tracking — Save is
  disabled until something changed and name is non-empty. No autosave.
- **Occasions card**: moved from the current detail page unchanged — type
  select (one-per-type rule, existing types disabled), DateSelectorPopover,
  pawukon preview, Feb-29 note, delete with AlertDialog.
- **Preferences card**: moved unchanged — offsets input, enabled switch,
  channel checkboxes with immediate save.
- **Header**: avatar + name, Delete contact (AlertDialog, wording unchanged).
- In create mode only the identity form renders (occasions/prefs need a
  contact id). A short hint tells the user they can add occasions and
  preferences after saving. After save the panel switches to the created
  contact — same surface, now complete.

### `components/contacts/contacts-grid.tsx`

Props: contacts, next-reminder map (contact_id → earliest upcoming item),
`selectedId`, callbacks `onSelect(id)`, `onDelete(id)`, `onAdd()`.

Built from reui primitives: `DataGrid`, `DataGridTable`,
`DataGridColumnHeader`, `DataGridPagination`, `DataGridScrollArea`,
`DataGridColumnVisibility`. Adaptations per `SHADCN.md`: replace
`IconPlaceholder` with lucide icons, drop unused imports so `tsc -b` stays
green.

## Grid Specification

**Toolbar**: search input (client-side, case-insensitive over name +
nickname) · column visibility toggle (Settings2 icon, `c-data-grid-20`
pattern) · **Add contact** button (primary).

**Columns**:

| Column | Content | Sortable | Default |
|---|---|---|---|
| Name | Avatar initials + name, nickname underneath (muted) | yes | visible, not hideable |
| Next reminder | `Otonan · 18 Jun` + countdown chip `in 12 days` — earliest `/upcoming` occasion per contact within `from=today&to=+400d`; `—` when none or fetch failed | yes (days_until) | visible |
| Occasions | Badge per type + formatted date (0–3 items) | no | visible |
| Status | Active (success outline) / Paused (warning outline) from `prefs.enabled` | yes | visible |
| Notes | StickyNote icon + truncated preview (tooltip); `—` when empty | no | **hidden** |
| Actions | Row dropdown: Open (same as row click), Delete (AlertDialog) | no | visible, not hideable |

No row-selection checkboxes (bulk delete was declined).

**Footer**: pagination, 10 rows default (10/20/50), "x of y contacts",
prev/next. Page resets to 1 when search or sorting changes.

**States**: default sort name A–Z; empty dataset → CTA "Add your first
contact"; empty search result → "No contacts match"; narrow screens scroll
horizontally via `DataGridScrollArea`.

## Data Flow

- `['contacts']` — unchanged endpoint; grid does client-side search/sort/
  pagination (personal scale).
- `['upcoming', 'grid']` — `/upcoming?from=<today>&to=<+400d>` (400-day max),
  filter `kind === 'occasion'`, sort by date ascending, take the first item
  per `contact_id`. Failure degrades to `—` in the Next-reminder column
  without blocking the grid.
- Panel and fullscreen page share the `['contact', id]` query key, so edits
  made in one view refresh the other.
- The countdown counts to the occasion date (not the first reminder send);
  paused contacts still show their next occasion — the Status column conveys
  paused state.

**Mutations**

| Action | On success |
|---|---|
| Create | invalidate `['contacts']` + `['upcoming', 'grid']`; navigate per History behavior; success toast |
| Save identity (PATCH) | invalidate contact + `['contacts']`; toast |
| Delete (panel or row action) | invalidate contacts/upcoming; navigate per History behavior; toast |
| Occasions / prefs | existing invalidations, plus `['upcoming', 'grid']` so countdowns refresh |

## Error Handling & Edge Cases

- Invalid `?c=` value → dropped by `validateSearch`; no panel.
- Non-numeric `$id` → redirect to the list (the `new` route owns `new`).
- Contact 404 → "Contact not found" empty state with a back button.
- Panel loading → skeleton rows.
- Every mutation shows `toast.error` on failure (pattern already used by
  `savePrefs`); create/save/delete also toast on success.

## Installation

```
pnpm dlx shadcn@latest add @reui/c-data-grid-23 @reui/c-data-grid-20 --yes
pnpm dlx shadcn@latest add textarea   # notes field (base-nova style)
```

- Brings `@reui/data-grid*` primitives + the demo examples (unused,
  tree-shaken) and adds `@tanstack/react-table`.
- The installed demos are reference material; the real grid composes the
  primitives directly.
- Expect small post-install fixes (import cleanup, `import.meta.env`) per
  `SHADCN.md`.

## Testing & Verification

No frontend test runner exists; verification is `tsc -b`, `pnpm lint`,
`pnpm build`, plus a manual checklist on the dev server:

1. Create docked (`?c=new`) → save → becomes selected contact.
2. Create fullscreen (`/new`) → save → URL replaces to `/contacts/<id>`.
3. Edit identity in panel and in fullscreen; dirty-state gating works.
4. Expand docked → fullscreen URL change; Collapse → back to `?c=id`;
   browser Back does not replay selections or re-open collapsed views.
5. <lg: row click and Add navigate directly; no panel rendered.
6. Delete from panel and from row action; deleting the selected contact
   clears selection.
7. Search filters; sorting works per column; pagination resets on
   search/sort change.
8. Column visibility toggle; Notes hidden by default.
9. Next-reminder countdown matches an occasion inside the 400-day window;
   `—` for contacts without one.
10. Go tests untouched (`go test ./...`) — no backend changes in scope.

## Out of Scope

- Bulk selection / bulk delete (would need a bulk endpoint).
- Persisting column visibility or page size across sessions.
- Server-side pagination/search.
- Editing occasions inline in the grid (occasions stay in the panel/page).
