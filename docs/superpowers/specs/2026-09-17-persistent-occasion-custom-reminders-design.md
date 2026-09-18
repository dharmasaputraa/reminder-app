# Design Doc: Persistent Per-Occasion Custom Reminders

Date: 2026-09-17
Status: approved

## Goals

1. "Custom reminders" per occasion becomes a persistent active/inactive toggle: turning it
   off must NOT wipe the saved days-before and channel selection — they are kept in the
   database and restored when toggled back on.
2. The section titles reflect state: "Custom reminders" ↔ "Inherit reminders", and the
   occasion switch label reads "Active" ↔ "Inactive".
3. When custom is off, the panel locks collapsed (cannot be uncollapsed) and shows a hint
   of the retained values instead of the inputs.
4. Channel selection chips lose their checkbox and instead style the whole chip by
   checked state, with a per-channel-type SVG icon stacked above the name.
5. Disabling "Reminders for this occasion" or "Custom reminders" requires a confirmation
   dialog; enabling applies immediately (no dialog).
6. When the contact-level Reminder Preferences are paused (master Active off), all
   per-occasion switches are disabled. Clicking a disabled switch opens a dialog offering
   to turn the master Active back on.

Decisions from brainstorming:

- Confirmation dialogs fire on disable only; enabling is a single click.
- Channel chips: stacked layout (icon above, name below), checkbox removed — selected
  state is communicated purely by chip styling (primary tint) vs muted unselected.
- The locked panel shows a retained-data hint ("Saved: 7, 3, 0 · 2 channels").
- The force-activate dialog only flips the contact-level Active switch back on; it does
  not auto-apply the switch the user originally clicked (they re-click it themselves).
- Approach: add an explicit `custom` column to `occasion_prefs` (approach A). Row
  presence no longer encodes custom-ness; a shadow-table/localStorage alternative was
  rejected (two sources of truth / not durable).

## 1. Data model & migration

New migration `002_occasion_prefs_custom.sql`:

```sql
ALTER TABLE occasion_prefs ADD COLUMN custom INTEGER NOT NULL DEFAULT 1;
```

Every pre-existing row was created by the old toggle-on path, so `DEFAULT 1` (custom)
is the correct backfill.

`store.OccasionPrefs` gains `Custom bool` (`json:"custom"`). Semantics:

- `custom=true` — offsets/channel_ids are live overrides (today's behavior).
- `custom=false` — the occasion inherits offsets/channels from the contact chain, but
  the stored values are retained data that reactivates on `custom=true`.
- `enabled` stays the independent per-occasion kill switch ("Reminders for this
  occasion"), meaningful in both custom states.
- No row at all — pure inherit, `custom` defaults false on the wire.

The full-replace PUT shape (`occasionPrefsIn`) gains `Custom *bool`; an absent field
decodes as `true` for backward compatibility with old clients (their payloads always
meant custom-on). `handleGetOccasionPrefs`'s default payload for a rowless occasion
becomes `{offsets:{}, channel_ids:[], enabled:true, custom:false}`.

`DELETE /occasions/:id/prefs` stays as an API-level reset-to-inherit (full wipe) but the
SPA no longer calls it.

## 2. Scheduler

One change in the occasion loop of `internal/scheduler/scheduler.go`: the occasion-level
offsets and channel overrides are only read when `occ.Prefs.Custom` is true; otherwise
the occasion resolves through the existing contact → settings → default chain exactly as
a rowless occasion does. The `enabled` check is unchanged and runs first —
`custom=false, enabled=false` still skips the occasion entirely.

## 3. Editor UI (`OccasionPrefsEditor`)

The local `Row` type gains `custom`, flowing through the existing authoritative-row
machinery (`row`/`rowRef`/`commit`/`sameRow`) so back-to-back toggles stay race-safe and
failed PUTs roll back as today.

- **Reminders for this occasion** — switch unchanged; its label reads **Active** when
  `enabled`, **Inactive** otherwise. ON saves immediately; OFF opens a confirm dialog
  ("Pause reminders for this occasion?") before saving `enabled:false`.
- **Custom reminders** — the section title reads **Custom reminders** when `custom`,
  **Inherit reminders** otherwise. Turning ON saves `custom:true`, re-opens the panel,
  and previously saved values reappear in the inputs. Turning OFF confirms first
  ("Saved days and channels are kept and restored when you re-enable"), then saves
  `custom:false` and collapses.
- **Locked panel** — with `custom=false` the `CollapsibleTrigger` is disabled (panel
  cannot be uncollapsed; no expand affordance) and the collapsible body is replaced by
  a muted hint line inside the header block, built from the retained row, e.g.
  `Saved: 7, 3, 0 · 2 channels`; no hint line when nothing was ever saved. The old
  caption ("Turn Custom reminders off to inherit everything from the contact") is
  replaced by retention wording.
- Both switches: confirmation on the off direction only, per the decision above.
- The custom switch disables itself while a save/reset is in flight (existing guard).

## 4. Channel chips

Each channel renders as one stacked, whole-chip `<button>` (checkbox removed):
per-type SVG icon centered on top, channel name below. Styling carries the state:

- selected: primary-tinted background, primary border, primary text
  (`bg-primary/10 border-primary`-class treatment);
- unselected: muted border and muted text.

A shared icon map (`gotify` → message-square, `telegram` → send/paper-plane,
`email` → mail, unknown → message-square) lives in `web/src/lib` so other surfaces
(e.g. the settings channels list) can reuse it. Clicking anywhere on the chip toggles
membership and saves immediately, as the checkbox did.

## 5. Paused-contact gating

`OccasionsTab` derives `paused = contact.prefs?.enabled === false`.

- While paused, both switches on every occasion render disabled (muted styling +
  `aria-disabled`) but remain clickable — not via the Switch's `disabled` prop, which
  swallows clicks; the look is achieved with styling classes while the click handler
  opens the dialog: "Notifications for
  this contact are paused. Turn them back on?" Confirm sends
  `PUT /contacts/:id/prefs {"enabled":true}` and invalidates the contact query. The
  switches unlock; the user then re-clicks the switch they wanted (no auto-apply).
- A slim muted banner above the occasions list explains the state ("Notifications are
  paused for this contact — enable them in Reminder Preferences").
- Offsets inputs and channel chips stay editable while paused (they only store data;
  nothing sends while the master is off). Only the two switches are gated.

## 6. List badges (`OccasionsTab` rows)

- **Custom** badge: shown only when `prefs.custom === true` — not on mere row presence.
  This also fixes the existing quirk where pausing an inherit-only occasion (which
  pins an `enabled=false` row) sprouted a "Custom" badge.
- **Paused** badge: unchanged (`prefs.enabled === false`).

## 7. Error handling & testing

Backend (Go tests):

- Store: `custom` round-trips through `SetOccasionPrefs`/`getOccasionPrefsRow`.
- API: `PUT custom:false` retains offsets/channel_ids; a legacy payload without
  `custom` still lands as `custom:true`; GET default payload has `custom:false`.
- Scheduler: a `custom=false` occasion falls back to contact-level offsets/channels;
  `enabled=false` still skips; `custom=true` behaves as today.

Frontend: typecheck + build, and a manual pass through each flow — both confirm dialogs
(accept and cancel), locked panel with hint, re-enable restoring values, paused gating
end-to-end, badges.

## Files touched

- `internal/store/migrations/002_occasion_prefs_custom.sql` (new)
- `internal/store/contacts.go` — `OccasionPrefs.Custom`, scan/write updates
- `internal/api/occasionprefs.go` — wire shape, defaults
- `internal/scheduler/scheduler.go` — custom gate in the occasion loop
- `internal/api/server_test.go`, `internal/store/contacts_test.go`,
  `internal/scheduler/scheduler_test.go` — tests
- `web/src/lib/api.ts` — `OccasionPrefs.custom`
- `web/src/lib/channel-icons.ts` (new) — per-type icon map
- `web/src/components/contacts/occasion-prefs-editor.tsx` — titles, confirm dialogs,
  locked panel + hint, stacked chips
- `web/src/components/contacts/occasions-tab.tsx` — paused gating, banner, badge fix
