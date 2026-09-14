# Reminder URL Query Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reminder dashboard's visible calendar month and opened event detail live in the URL (`?month=YYYY-MM&event=occasion-42`), with push/replace history semantics per the approved spec.

**Architecture:** URL is the single source of truth via TanStack Router's route-level `validateSearch` on `/reminder/`. Pure param helpers live in a new `web/src/lib/reminder-search.ts`; `web/src/routes/reminder.index.tsx` derives `visibleDate` and `detailItem` from the search instead of `useState`, and writes back with `navigate()` (month = replace, event open = push, event close = replace).

**Tech Stack:** TanStack Router v1.170 (`validateSearch`, `Route.useSearch`, `Route.useNavigate`), React 19, date-fns (`format`), existing reUI `EventCalendar` (controlled `date` prop — verified: `getState` reads `options.date ?? internal.date`).

**Spec:** `docs/superpowers/specs/2026-09-14-reminder-url-sync-design.md`

## Global Constraints

- Param grammar (verbatim from spec): month `^\d{4}-(0[1-9]|1[0-2])$`; event `^(occasion-\d+|holiday-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))$`.
- History rules (verbatim): month navigation → `replace: true`; opening an event → push; opening another event → push again; closing (panel back / dialog close / lg day-click) → replace that drops `event` only.
- No new npm dependencies. No backend changes. No web unit-test infra exists (scripts: dev/build/lint only) — per-task gates are `npm run lint` + `npm run build`; end-to-end behavior gets a manual browser checklist in Task 4.
- Out of scope (do not touch): calendar view-type sync, agenda collapse sync, below-lg day dialog (`dayDialogDate` — stays local state), `routeTree.gen.ts` (types flow from the route file itself; no regeneration needed for `validateSearch`).
- Known behavior change (accepted by spec): the URL stores month grain, so a day picked in the date selector collapses to that month's 1st on reload. `views={['month','agenda']}` means no time-grid day navigation is affected.
- Deep-link panel edge (spec): on mount `agendaOpen` initial state is already `true`, so a deep link with `?event=` renders the panel open by construction — no extra effect; `openDetail` already re-opens it after an explicit collapse.

---

### Task 1: Search-param helper module

**Files:**
- Create: `web/src/lib/reminder-search.ts`

**Interfaces:**
- Consumes: `UpcomingItem` type from `web/src/lib/api.ts` (fields: `kind: 'occasion' | 'holiday'`, `occasion_id?: number`, `date: string` as `YYYY-MM-DD`).
- Produces (used by Tasks 2–3):
  - `interface ReminderSearch { month?: string; event?: string }`
  - `validateReminderSearch(search: Record<string, unknown>): ReminderSearch`
  - `reminderEventId(it: UpcomingItem): string | null`
  - `findReminderItem(items: UpcomingItem[], eventId: string): UpcomingItem | undefined`

- [ ] **Step 1: Create the helper module**

```ts
import type { UpcomingItem } from './api'

/** URL search contract for /reminder/ — see
 *  docs/superpowers/specs/2026-09-14-reminder-url-sync-design.md. */
export interface ReminderSearch {
  /** Visible calendar month, `YYYY-MM`. */
  month?: string
  /** Opened event: `occasion-<occasion_id>` or `holiday-<YYYY-MM-DD>`. */
  event?: string
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const EVENT_RE = /^(occasion-\d+|holiday-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))$/

/** Route `validateSearch`: keeps only well-formed params, drops the rest so a
 *  bad URL self-cleans instead of erroring. */
export function validateReminderSearch(
  search: Record<string, unknown>
): ReminderSearch {
  const month =
    typeof search.month === 'string' && MONTH_RE.test(search.month)
      ? search.month
      : undefined
  const event =
    typeof search.event === 'string' && EVENT_RE.test(search.event)
      ? search.event
      : undefined
  return { ...(month && { month }), ...(event && { event }) }
}

/** Stable URL identity for an item. Occasions are keyed by id (two different
 *  occasions can fall on the same date); holidays have no id, and kind+date
 *  is unique for them. Returns null only for an occasion missing its id —
 *  the backend always sends one, so callers just skip such an item. */
export function reminderEventId(it: UpcomingItem): string | null {
  if (it.kind === 'occasion')
    return it.occasion_id != null ? `occasion-${it.occasion_id}` : null
  return `holiday-${it.date}`
}

/** Look a URL event id up in already-fetched items. */
export function findReminderItem(
  items: UpcomingItem[],
  eventId: string
): UpcomingItem | undefined {
  if (eventId.startsWith('occasion-')) {
    const id = Number(eventId.slice('occasion-'.length))
    return items.find((it) => it.kind === 'occasion' && it.occasion_id === id)
  }
  const date = eventId.slice('holiday-'.length)
  return items.find((it) => it.kind === 'holiday' && it.date === date)
}
```

- [ ] **Step 2: Verify types and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && npm run lint && npm run build`
Expected: lint passes; `tsc -b` and `vite build` succeed (module unused yet — that is fine; oxlint does not flag unused exports).

- [ ] **Step 3: Commit**

```bash
cd /Users/taksu/Work/code/otorem && git add web/src/lib/reminder-search.ts && git commit -m "feat(web): search param helpers for reminder url sync"
```

---

### Task 2: Route validateSearch + month sync

**Files:**
- Modify: `web/src/routes/reminder.index.tsx` (route definition ~line 41-44; Dashboard state ~line 122-124; `EventCalendar` props ~line 250, 262)

**Interfaces:**
- Consumes: `validateReminderSearch`, `ReminderSearch` from Task 1; existing `localMidnight()` in the route file.
- Produces: `Route` with typed search (`Route.useSearch()` returns `ReminderSearch`); `setMonthParam(d: Date)` replace-navigation; derived `visibleDate: Date | null` (null = no param yet, calendar uncontrolled on today). Tasks 3 relies on `search`, `navigate`, `visibleMonth`, `calendarItems`, `yearQueries`.

- [ ] **Step 1: Add imports**

At the top of `web/src/routes/reminder.index.tsx`, add `format` from date-fns and the helpers:

```ts
import { format } from 'date-fns'
import {
  validateReminderSearch,
  type ReminderSearch,
} from '../lib/reminder-search'
```

- [ ] **Step 2: Wire validateSearch into the route**

Replace the current route definition:

```ts
export const Route = createFileRoute('/reminder/')({
  validateSearch: validateReminderSearch,
  component: Dashboard,
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
})
```

- [ ] **Step 3: Replace visibleDate state with URL-derived value**

Inside `Dashboard`, right after `const todayYear = …` (currently line ~121), replace:

```ts
  // Visible calendar month (from navigation); null = never navigated (today).
  const [visibleDate, setVisibleDate] = useState<Date | null>(null)
```

with:

```ts
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  // Visible calendar month, owned by the URL (`?month=`); null = no param yet,
  // so the calendar stays uncontrolled and shows today.
  const visibleDate = search.month ? localMidnight(`${search.month}-01`) : null
  // Replace-navigation: browsing months rewrites one history entry instead of
  // piling one up per month (spec: month replace, event push).
  const setMonthParam = (d: Date) =>
    navigate({
      search: (prev: ReminderSearch) => ({ ...prev, month: format(d, 'yyyy-MM') }),
      replace: true,
    })
```

- [ ] **Step 4: Make the calendar URL-controlled**

In the `<EventCalendar …>` JSX, add a controlled `date` prop next to the existing `defaultDate` (they coexist: undefined `date` falls back to the internal `defaultDate` state):

```tsx
            date={visibleDate ?? undefined}
            defaultDate={up.data?.today ? localMidnight(up.data.today) : new Date()}
```

and replace `onDateChange={(d) => setVisibleDate(d)}` with:

```tsx
            onDateChange={setMonthParam}
```

All nav controls (Today, Prev/Next, date selector) funnel through `onDateChange`, so the first manual navigation writes `month` and it stays in sync.

- [ ] **Step 5: Verify types, lint, and build**

Run: `cd /Users/taksu/Work/code/otorem/web && npm run lint && npm run build`
Expected: pass. If TS complains about the `search` updater type, the route's `validateSearch` return type drives it — do not cast with `as any`; keep the explicit `ReminderSearch` annotation.

- [ ] **Step 6: Commit**

```bash
cd /Users/taksu/Work/code/otorem && git add web/src/routes/reminder.index.tsx && git commit -m "feat(web): sync visible calendar month to ?month= url param"
```

---

### Task 3: Event detail sync (push/replace + deep link + self-healing)

**Files:**
- Modify: `web/src/routes/reminder.index.tsx` (detail state ~line 174-186; self-healing effect new; `onSlotClick` ~line 263-272; `AgendaPanel` props ~line 349-350; below-lg dialogs ~line 424-430)

**Interfaces:**
- Consumes: `search`, `navigate`, `visibleMonth`, `calendarItems`, `yearQueries` from Task 2; `reminderEventId`, `findReminderItem`, `ReminderSearch` from Task 1.
- Produces: derived `detailItem: UpcomingItem | null` (feeds both the lg `AgendaPanel` and the below-lg `EventDetailDialog`); `openDetail(it)` push-navigation; `closeDetail()` replace-navigation. No new exports.

- [ ] **Step 1: Add useEffect import**

Extend the first React import (useState/useMemo/useRef are still used):

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 2: Derive detail from the URL instead of state**

After the `events` memo (currently ~line 136), add `yearsSettled` and the resolved item, and delete the two state lines shown below:

```ts
  const yearsLoading = yearQueries.some((q) => q.isLoading)
  const yearsSettled = yearQueries.every((q) => q.isSuccess)
```

Delete these two lines (they are replaced by the URL-derived value):

```ts
  const [detailItem, setDetailItem] = useState<UpcomingItem | null>(null)
  const [dialogDetail, setDialogDetail] = useState<UpcomingItem | null>(null)
```

and in their place put:

```ts
  // Event detail is owned by the URL (`?event=`): the side panel (lg) and the
  // below-lg dialog resolve the same param against the fetched items.
  const resolvedEvent = useMemo(
    () =>
      search.event ? findReminderItem(calendarItems, search.event) : undefined,
    [calendarItems, search.event]
  )
  const detailItem = resolvedEvent ?? null

  // Deep link + self-healing: a bare `event` param gets its month inferred —
  // holiday ids carry the date (`holiday-2026-03-11` → `2026-03`), occasions
  // once they resolve — so the right year loads. A well-formed id that no
  // loaded year knows is stripped once the anchor years have settled.
  useEffect(() => {
    const eventId = search.event
    if (!eventId) return
    if (!search.month) {
      const target =
        resolvedEvent?.date.slice(0, 7) ??
        (eventId.startsWith('holiday-') ? eventId.slice(8, 14) : undefined)
      if (target) {
        navigate({
          search: (prev: ReminderSearch) => ({ ...prev, month: target }),
          replace: true,
        })
        return
      }
    }
    if (yearsSettled && !resolvedEvent) {
      navigate(
        { search: (prev: ReminderSearch) => ({ month: prev.month }), replace: true }
      )
    }
  }, [search.event, search.month, resolvedEvent, yearsSettled, navigate])
```

(For `holiday-2026-03-11`, `slice(8, 14)` = `"2026-03"` — the id prefix is exactly 8 chars.)

- [ ] **Step 3: Rewrite openDetail / add closeDetail as navigation**

Replace the current `openDetail` function with:

```ts
  /** Open detail: push, so browser Back closes the panel/dialog. The month
   *  param rides along when missing, keeping shared URLs self-contained. */
  const openDetail = (it: UpcomingItem) => {
    const event = reminderEventId(it)
    if (!event) return
    if (isLg) setAgendaOpen(true)
    navigate({
      search: (prev: ReminderSearch) => ({
        ...prev,
        month: prev.month ?? format(visibleMonth, 'yyyy-MM'),
        event,
      }),
    })
  }

  /** Close detail: replace-drop the param (keep `month`) so no stale history
   *  entry reopens it later; no-op when nothing is open. */
  const closeDetail = () => {
    if (!search.event) return
    navigate({
      search: (prev: ReminderSearch) => ({ month: prev.month }),
      replace: true,
    })
  }
```

`openDetail` must be defined after `visibleMonth` (it already sits below that memo in the file — keep it there).

- [ ] **Step 4: Rewire the call sites**

1. `onSlotClick` lg branch — replace `setDetailItem(null)` with `closeDetail()`:

```tsx
            onSlotClick={(slot) => {
              if (isLg) {
                // back to the list, then glide to the clicked day
                closeDetail()
                setAgendaOpen(true)
                scrollAgendaToDay(slot.date)
              } else {
                setDayDialogDate(slot.date)
              }
            }}
```

2. `AgendaPanel` — replace `onBack={() => setDetailItem(null)}` with:

```tsx
              onBack={closeDetail}
```

(`detailItem={detailItem}` keeps working unchanged — same name, now derived.)

3. Below-lg `EventDetailDialog` — replace `item={dialogDetail}` and its close handler:

```tsx
          <EventDetailDialog
            item={detailItem}
            onOpenChange={(open) => {
              if (!open) closeDetail()
            }}
          />
```

`openDetail`'s other call sites (event chips, "+N more" popover, mobile cards, `DayEventsDialog.onOpenEvent`) are untouched — they all go through the rewritten `openDetail`.

- [ ] **Step 5: Verify types, lint, and build**

Run: `cd /Users/taksu/Work/code/otorem/web && npm run lint && npm run build`
Expected: pass, with no unused-symbol warnings (`setDetailItem`/`setDialogDetail` are gone).

- [ ] **Step 6: Commit**

```bash
cd /Users/taksu/Work/code/otorem && git add web/src/routes/reminder.index.tsx && git commit -m "feat(web): sync opened event detail to ?event= url param with push/replace history"
```

---

### Task 4: Full build + manual browser checklist

**Files:**
- none (verification only; commit fixes against `web/src/routes/reminder.index.tsx` if a check fails)

**Interfaces:**
- Consumes: completed Tasks 1–3.

- [ ] **Step 1: Production build**

Run: `cd /Users/taksu/Work/code/otorem/web && npm run build`
Expected: clean `tsc -b && vite build`.

- [ ] **Step 2: Serve and walk the checklist**

Start `npm run dev` and exercise both widths (lg ≥ 1024px with the side panel; below lg with dialogs). From the spec:

Month (lg and narrow):
1. Prev/Next/Today/date-selector → URL gains/updates `?month=YYYY-MM`; reload keeps the month.
2. Browse several months, press Back once → leaves the page (replace semantics), no month-by-month rewind.

Event (lg):
3. Click an event chip → panel opens, URL gains `?event=occasion-N` (or `holiday-…`) via push; Back closes the panel; Forward reopens it.
4. Open a second event while one is open → another push; Back walks back through opened events.
5. Close via the panel's back arrow → `event` gone, `month` kept; pressing Back afterwards does not reopen it.
6. Click a day cell while a detail is open → detail closes (replace), agenda scrolls to that day.
7. Collapse the panel, click an event → panel reopens with the detail.

Event (narrow):
8. Card/chip click opens `EventDetailDialog` with the same URL behavior; closing via ESC/overlay/back arrow drops the param.
9. `DayEventsDialog` still works with no `event` param of its own (local state, unchanged).

Deep links (fresh tab):
10. `/reminder?month=2026-09&event=occasion-<real id>` → September, detail open, panel open.
11. `/reminder?event=holiday-2026-03-11` (no month) → lands on March 2026 with the holiday detail open.
12. `/reminder?event=occasion-<real id>` (no month, occasion within ±1 year) → month fills in from the resolved date.
13. `/reminder?month=garbage`, `/reminder?event=garbage`, `/reminder?event=holiday-2026-13-99` → dropped/cleaned (immediately or after year data settles), never an error.

- [ ] **Step 3: Commit any fixes**

```bash
cd /Users/taksu/Work/code/otorem && git add web/src/routes/reminder.index.tsx && git commit -m "fix(web): url sync adjustments from manual pass"
```

(Skip if the checklist passed with no changes.)
