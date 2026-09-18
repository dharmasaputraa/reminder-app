# Channels & Settings Refactor — Design

Date: 2026-09-18
Branch: `feature/channels-settings-refactor`

## Problem

`web/src/routes/reminder.channels.tsx` and `web/src/routes/reminder.settings.tsx`
are monolithic route files: queries, mutations, form state, and markup all
inline. They also lag the quality bar of the contacts pages and dashboard:
no skeleton loading states, no structured error states, `Loading…` text, and
no title-left/action-right page header.

## Scope (decided)

Structure + UX polish. Extract components following the contacts-page
architecture (self-contained domain components, thin route files) and close
the UX gaps. **All existing behavior is preserved**, except two deliberate
deltas (below).

Out of scope: URL-owned state, docked side panels, responsive re-layouts
(the "full reference alignment" option was declined).

## Approach (decided: A — self-contained domain components)

Components own their own queries/mutations; routes only compose. This mirrors
`ContactDetailPageContent` / `ContactEditForm`, not the presentational
`ContactsGrid` (the exception in the reference set).

### New components

1. **`web/src/components/channels/channel-list.tsx`** — self-contained.
   Owns the `['channels']` + `['settings']` queries and the row mutations:
   set-default (PUT `/settings` `default_channel_ids`), toggle active (PATCH),
   test (POST `/channels/:id/test`), delete (DELETE with AlertDialog confirm).
   Renders: skeleton while loading; error line on query failure; an empty
   state ("No channels yet" + hint to use the header button) when the list
   is empty; otherwise the channel cards (type badge,
   `ChannelIcon`, name, Default checkbox, active Switch, Test, Delete) exactly
   as today. The span-not-label wrapping around Checkbox/Switch is preserved
   (double-fire fix from de7011d).
2. **`web/src/components/channels/add-channel-dialog.tsx`** — owns the create
   mutation and form state; `TIPE` and `FIELDS` constants move here.
   Props: `open`, `onOpenChange`. Body: type Select, name Input, per-type
   config fields, the AES-256-GCM encryption Alert, Save button.
3. **`web/src/components/settings/settings-page-content.tsx`** —
   self-contained. Owns the `['settings']` + `['me']` queries, all form state
   (timezone, send time, catch-up hours, default offsets text, holiday
   category/offset texts, recurrence offset texts), and the save mutation.
   Renders: skeleton while loading; structured load-failure message; Reminder
   Preferences card; Recurrence offsets card; one Save button; signed-in
   footer.
4. **`web/src/components/settings/timezone-select.tsx`** — pure extraction.
   `TZ_INDONESIA`, `TZ_LAINNYA`, `gmtOffset`, `tzOptionText`, and the grouped
   Select (stored-value-not-in-list handling preserved). Props: `value`,
   `onChange`.

### Route files (thin)

- **`reminder.channels.tsx`** — route definition + page component: header row
  (title + the "contacts without their own channel selection…" description on
  the left, **Add channel** Button on the right — the Contacts header
  pattern), then `<ChannelList />` and `<AddChannelDialog>` with local `open`
  state.
- **`reminder.settings.tsx`** — route definition + page title +
  `<SettingsPageContent />`.

## Deliberate behavior deltas

1. **Add-channel dialog closes after successful create.** The form still
   resets (as today); a dialog that stays open after success reads as an
   error.
2. **Settings has one Save button** instead of two identical ones (both
   saved everything). Still disabled while `save.isPending` or any recurrence
   stream parses to an empty list; same validation message.

## Behavior preservation checklist

- Default-channel semantics (checkbox, immediate save, disabled while
  settings pending).
- Active toggle, test toasts, delete confirmation copy.
- Holiday categories: checkboxes, per-category offsets (disabled when
  unchecked), reset-to-default.
- Recurrence offsets: four streams, at least one offset each, error message,
  gating Save.
- Encryption notice on the add form.
- Timezone select: grouped Indonesia/Other, GMT offset suffix, stored value
  shown even when not in the lists.
- Signed-in footer (email + role).
- `pageTitle` head metadata on both routes.

## Testing / verification

- Web typecheck, lint, and build green.
- Manual pass over both pages in the dev server: load, create channel,
  toggle default/active, test, delete; settings load, edit, save, reset
  holiday categories.
