import { useEventCalendarNavigation } from "@/components/reui/event-calendar/event-calendar"

import {
  DateSelectorPopover,
  dateSelectorValueToDate,
} from "@/components/date-selector-popover"

/**
 * Go-to-date control for the calendar nav, backed by the reUI DateSelector
 * popover (c-date-selector-2). Replaces the old ±1-year jump buttons: any
 * period (day/month/quarter/half-year/year) can be picked or typed, and
 * Apply anchors the calendar on that period's first day. Must be rendered
 * inside <EventCalendar> so it can use the navigation context.
 */
export function CalendarDateSelectorButton() {
  const { goTo } = useEventCalendarNavigation()
  return (
    <DateSelectorPopover
      value={undefined}
      onApply={(value) => {
        const target = dateSelectorValueToDate(value)
        if (target) goTo(target)
      }}
      placeholder="Go to date"
      label="Go to date"
      minYear={1900}
    />
  )
}
