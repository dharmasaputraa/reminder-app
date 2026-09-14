# Calendar upgrade: settings popover, click dialogs, DateSelector navigation

## What I found

- The dashboard (`web/src/routes/index.tsx`) already renders the vendored reUI event calendar (`src/components/reui/event-calendar/`, from `c-event-calendar-3`). The core calendar is the same across variants — `c-event-calendar-1` adds the **Settings popover** on top of it.
- Year-jump buttons live in `index.tsx` (`YearJumpButton`, lines 114–126 and 198–203). No year/month dropdown exists anywhere yet.
- The only app date picker is the occasion date on `contacts.$id.tsx:166-188` (Popover + shadcn `ui/calendar`). `c-date-selector-2` is not installed.
- Dialogs: `src/components/ui/dialog.tsx` (Base UI — the component reui.io/docs/dialog documents) already exists; `examples/c-event-calendar-3.tsx` shows the `onEventClick`/`onSlotClick` wiring pattern. Event chips already `stopPropagation()`, so clicking an event won't also fire the day-cell click.
- Calendar events come from `GET /api/v1/upcoming` (`UpcomingItem`: date, kind, title, type, contact_id, contact_name, pawukon, days_until, reminders).

Per your note: **components are used as reUI ships them — no cutting/pruning** (no Behavior/Time-grid tab omissions, full DateSelector period types everywhere). Any trimming only on your explicit request later.

## Plan

### 1. Install registry items (in `web/`)
- `pnpm dlx shadcn@latest add @reui/c-event-calendar-1` → adds `src/components/examples/c-event-calendar-1.tsx`. When prompted about the already-vendored `@reui/event-calendar` files, **do not overwrite** (they carry local adaptations from `web/SHADCN.md`).
- `pnpm dlx shadcn@latest add @reui/c-date-selector-2` → adds `src/components/reui/date-selector.tsx` (core) + `src/components/examples/c-date-selector-2.tsx`. Its ui deps (button, calendar, input, scroll-area, tabs, use-mobile) already exist.
- Apply only the necessary build adaptations from SHADCN.md (`process.env.NODE_ENV` → `import.meta.env.DEV`, unused imports) so `tsc -b` stays green. Fall back to `npx shadcn@3.8.5` if CLI 4.x rejects the registry.

### 2. Settings popover — full `c-event-calendar-1` as shipped
Add the Settings popover from `c-event-calendar-1` to the dashboard calendar, unmodified in scope: **View tab** (weekends, week numbers, now indicator, off days, day add button, week starts on), **Time grid tab** (day start/end hour, grid interval, drag snap — shown per the example's own logic when a time-grid view is active), **Behavior tab** (drag / resize / select-slot / tooltips), **Region tab** (language select with the example's en/de/fr/es/ja/ar i18n presets + time zone select), and "Reset to defaults". Its state lives in `Dashboard` and flows into `<EventCalendar>` as controlled props (`viewSettings`, `interactions`, `weekStartsOn`, `dayStartHour`, `dayEndHour`, `interval`, `snapDuration`, `eventTooltip`, `showDayAddButton`, `offDays`, `locale`, `timeZone`, `i18n`) — exactly the props the example passes. Note: since events are server-derived, Behavior toggles act client-side only (visual, reset on refetch) — same as the example's own demo behavior.

### 3. Remove year-jump buttons; DateSelector in the nav
In `index.tsx`: delete `YearJumpButton` and its imports/usages. Add the `c-date-selector-2` popover (as shipped: full period types day/month/quarter/half-year/year, range support, text input with the "Try: 2025, Q4, …" hint, Cancel/Apply) as a calendar-icon trigger button in the nav next to Prev/Next. Apply → derive the target date from the selected value's start and `goTo(date)` via `useEventCalendarNavigation`, then close. Prev/Next (month step), Today, and the title stay. The ±1-year prefetch stays so jumps stay instant.

### 4. Day-click dialog (full view)
`onSlotClick` on the dashboard `<EventCalendar>` opens a new `web/src/components/day-events-dialog.tsx` using the existing `ui/dialog.tsx`: titled with the clicked date (e.g. "Monday, 14 Sep 2026"), listing that day's events in full — kind badge, title, contact, type, pawukon, D-N reminders — with an empty state. Rows open the event detail dialog.

### 5. Event-click detail modal
`onEventClick={(occ, e) => { e.preventDefault(); … }}` (opts out of built-in selection, per the vendored chip contract) opens a new `web/src/components/event-detail-dialog.tsx`: title, formatted date + TODAY/D-N badge, kind, contact name linked to `/contacts/$id` when `contact_id` exists, occasion type/number, pawukon, reminders. To feed both dialogs, `toCalendarEvent` stores the whole `UpcomingItem` in `event.data` instead of just `{ kind }`.

### 6. Contacts page date picker → `c-date-selector-2` as shipped
`contacts.$id.tsx:166-188`: replace the Popover + `ui/calendar` picker with the same full `c-date-selector-2` popover pattern (all period types, Cancel/Apply draft state). Apply sets the occasion `date` (ISO from the selected value's day/period start) and runs `previewPawukon` — behavior otherwise unchanged. The unused vendored `EventCalendarDatePicker` in `event-calendar-nav.tsx` is left untouched.

Demo example files (`c-event-calendar-1.tsx`, `c-date-selector-2.tsx`) stay in `examples/` as reference, matching the existing `c-event-calendar-3.tsx` convention. New UI copy in inline English (app convention).

## Verification
- `pnpm -C web build` (tsc + vite) clean.
- Run dev server and click through in the browser: full Settings popover tabs work and apply to the calendar, year buttons gone, nav DateSelector jumps the calendar, clicking a date opens the day dialog, clicking an event opens only the detail modal, contacts date picker works including pawukon preview.