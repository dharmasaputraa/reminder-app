# Mobile Header Submenu Removal + Calendar Toolbar Layout

> **For agentic workers:** small UI task executed inline. Spec/design approved in
> conversation 2026-09-14 (screenshot of broken mobile toolbar provided by user).

**Goal:** Remove the duplicate header submenu on mobile (content already in the
sidebar sheet) and give the calendar toolbar a clean two-row layout on phones.

**Architecture:** Consumer-side layout changes only; one optional prop added to
the shared `DateSelectorPopover` (default behavior unchanged for the contacts
page). No reui internals touched.

## Task 1: Hide header submenu below md

**File:** `web/src/components/app-shell.tsx`
- The second header row (`border-b bg-muted/30`, NAV_SECTIONS links) gets
  `hidden md:block`. The sheet (`md:hidden`) already carries the same links;
  `md+` rendering is unchanged.

## Task 2: Calendar toolbar, two rows below sm

**Files:** `web/src/routes/reminder.index.tsx`, `web/src/components/date-selector-popover.tsx`

- `date-selector-popover.tsx`: add optional `labelClassName?: string`; wrap
  `{displayText}` in `<span className={labelClassName}>`. Default `undefined`
  renders identically for existing consumers.
- `reminder.index.tsx` toolbar block:
  - Outer container: `flex flex-col gap-2 pe-2 sm:flex-row sm:flex-wrap sm:items-center`
    (mobile = two stacked rows; `sm+` = current single wrapping row).
  - Row A (`EventCalendarNav`): Today · ‹ › · Title (`ms-1 sm:ms-3`, full width
    so it no longer truncates to "Oct…"). The view-switcher div moves OUT of the
    nav into the toolbar.
  - Row B (`EventCalendarToolbar`): view switcher (`lg:hidden`, left) ·
    `CalendarDateSelectorButton` (icon-only below `sm`:
    `className="size-9 justify-center px-0 sm:size-auto sm:px-3"`,
    `labelClassName="hidden sm:inline"`) · settings button · agenda toggle
    (`lg+`), with `justify-between sm:justify-start`.

## Verification

1. `npm run lint && npm run build` in web/.
2. Browser: 390px — header shows no submenu row; calendar toolbar is two clean
   rows, title untruncated, Go-to-date icon-only, popover still opens; 1440px —
   unchanged single-row toolbar with labeled Go to date; contacts page trigger
   unchanged.
