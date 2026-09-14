# URL Query Sync — Reminder Calendar (reminder.index.tsx)

Date: 2026-09-14
Status: approved (design discussion), pending implementation

## Problem

State on the reminder dashboard — which month the calendar shows and which
event is open in the side agenda panel (lg) or detail dialog (below lg) —
lives only in React state. Refreshing loses it, the browser Back button does
nothing meaningful, and there is no way to share a link to "September with
occasion #42 open".

## Goal

Reflect visible month and opened event in the URL query string so that:

- Refreshing keeps the view.
- Browser Back/Forward walks through opened events.
- URLs are shareable / bookmarkable (deep-link opens the same view cold).

## URL Contract

- `?month=YYYY-MM` — month displayed on the calendar. Optional; absent means
  "never navigated" (calendar shows today, URL stays clean).
- `?event=<id>` — opened event detail. Optional. Two id forms:
  - `occasion-<occasion_id>-<YYYY-MM-DD>` (e.g. `event=occasion-42-2026-03-11`)
    — occasions are identified by their database id so two different occasions
    falling on the same date never collide, and the date names the exact
    occurrence because a recurring occasion appears several times within the
    fetched ±1-year window.
  - `holiday-<YYYY-MM-DD>` (e.g. `event=holiday-2026-03-11`) — holidays have
    no id; kind + date is unique for them.
- Both params are independent. `event` without `month` resolves the month
  from the event's date.
- Invalid values (wrong shape) are dropped by `validateSearch` — they never
  reach the component and disappear from the URL.
- A valid-shaped `event` that matches no loaded item is stripped from the URL
  (replace navigation) once year data has finished loading (self-healing).

## History Behavior (decided)

- Month navigation → `replace: true`. Browsing 12 months leaves one history
  entry, not 12.
- Opening an event → push. Back closes the detail panel/dialog.
- Opening another event while one is open → push again (Back walks back
  through each opened event).
- Closing via the panel's back button / dialog close → `replace` that drops
  `event` only (keeps `month`). No stale reopen on later Back presses.

## Architecture

URL is the single source of truth; the component holds no month/detail
state. Approach: route-level `validateSearch` (canonical TanStack Router
pattern; first use in this codebase). Rejected alternatives: mirroring
existing `useState` to the URL via effects (two sources of truth, sync loops)
and third-party query-state libraries (overkill for two params).

Execution rulings that differ from the sketch below:

- The calendar stays uncontrolled with `key={search.month}` remounting it when
  the URL month changes, instead of receiving a controlled `date` prop. The
  agenda view steps ±30 days internally; a controlled anchor pinned to the 1st
  dead-ends 31-day months (stepping forward from the 1st of a 31-day month
  lands on the 1st of the next month at best, losing days), so prop-driven
  control was rejected.
- In this router version, `validateSearch` output is merged over the raw
  search (`Object.assign` in router-core), so simply omitting an invalid key
  would leave the raw value in the typed search. The validator therefore
  overwrites invalid params with explicit `undefined`; the search serializer
  drops undefined values, so the URL cleans itself up on the next navigation.

### Route wiring (`web/src/routes/reminder.index.tsx`)

```ts
export const Route = createFileRoute('/reminder/')({
  validateSearch: (search: Record<string, unknown>) => {
    const month = typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month)
      ? search.month : undefined
    const event = typeof search.event === 'string' &&
      /^(occasion-\d+|holiday-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))$/.test(search.event)
      ? search.event : undefined
    return { ...(month && { month }), ...(event && { event }) }
  },
  component: Dashboard,
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
})
```

### Component data flow

- `visibleDate` state is removed. Derived:
  `const visibleDate = search.month ? localMidnight(`${search.month}-01`) : null`.
- `EventCalendar` becomes URL-controlled when a month param exists:
  `date={visibleDate ?? undefined}` plus the existing `defaultDate` (today).
  Verified: the calendar reads `options.date ?? internal.date` in `getState`
  and, when `date` is defined, `setField('date')` skips its internal write and
  only calls `onDateChange` — so prop-driven Back/Forward navigation works.
- `onDateChange={(d) => navigate({ search: { ...search, month: fmt(d) }, replace: true })}`.
  Today/Prev/Next/date-picker all funnel through here; the first manual
  navigation fills in `month` and the URL stays in sync from then on.
- `detailItem` and `dialogDetail` state are removed. Both derive from
  `search.event` by looking the id up in the already-loaded per-year `events`
  (occasion → match `occasion_id`; holiday → match kind + date).
- `openDetail(it)`:
  - lg: push `event=<id>` (keep `month`), plus the existing local
    `setAgendaOpen(true)` side effect.
  - below lg: push `event=<id>`; the `EventDetailDialog` opens because
    `dialogDetail` resolves from the URL. Opening from within
    `DayEventsDialog` still closes that dialog first (local state, unchanged).
- Calendar day click at lg (`onSlotClick`): replace-navigation that drops
  `event` (keeps `month`), then scrolls the agenda as today.
- Panel back button / dialog `onOpenChange(false)`: replace-navigation that
  drops `event`.

### Deep link & loading

Cold load with `?month=…&event=…`: `month` sets the year anchor immediately,
so the anchor year query (already ±1 year) fetches the needed data; the
calendar and agenda render as soon as the year query settles. While loading,
the agenda shows its normal list (no dedicated detail skeleton — matches the
page's existing loading behavior). If `event` matches nothing after load, it
is stripped via replace.

One deep-link edge case: if the user arrives with `event` set while the side
panel is collapsed (or collapses it while a detail is open), the detail would
be invisible behind the closed panel. On mount with `event` present at lg,
the panel is forced open (one-shot effect); an explicit collapse afterwards
wins until the next `openDetail` (which already reopens the panel).

## Out of Scope

- Syncing the calendar view type (month/agenda), agenda collapse state, and
  the below-lg day dialog (`dayDialogDate`) — these stay local state.
- Backend changes: none; identity resolution is client-side over already
  fetched `/upcoming` payloads.

## Validation

Event param grammar (enforced in `validateSearch`):

- `occasion-\d+`
- `holiday-\d{4}-\d{2}-\d{2}` (month 01–12, day 01–31 — calendar-level
  correctness is not checked; a non-existent date simply matches no item and
  is self-healed)

Month param grammar: `\d{4}-(0[1-9]|1[0-2])`.

## Verification

No web unit-test infra exists (scripts: dev/build/lint only). Verification:

1. `cd web && tsc -b && vite build` and `oxlint` pass.
2. Manual, in browser (lg and below-lg widths):
   - Navigate months → URL updates (`replace`); reload keeps the month.
   - Open/close events (panel and dialog) → `event` appears (push) and
     disappears (replace); Back closes the detail.
   - Deep-link `?month=2026-09&event=occasion-42` in a fresh tab renders the
     right month with the detail open.
   - `?month=garbage`, `?event=garbage`, `?event=holiday-2026-13-99` are
     dropped or self-healed, leaving a clean URL.
