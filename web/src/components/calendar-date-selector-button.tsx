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
export function CalendarDateSelectorButton({
  className,
  labelClassName,
}: {
  className?: string
  labelClassName?: string
} = {}) {
  const { goTo } = useEventCalendarNavigation()
  const thisYear = new Date().getFullYear()
  return (
    <DateSelectorPopover
      className={className}
      labelClassName={labelClassName}
      value={undefined}
      onApply={(value) => {
        const target = dateSelectorValueToDate(value)
        if (target) goTo(target)
      }}
      placeholder="Go to date"
      label="Go to date"
      // Year list reaches back to 1800 (same bound as the contact occasion
      // picker); typed years inherit it through the selector's min/maxYear.
      minYear={1800}
      maxYear={thisYear + 15}
      // The calendar needs month precision; the Day tab stays available for
      // exact-day jumps, but picking a month does not force a drill-down.
      periodTypes={['day', 'month', 'year']}
      align="end"
      showFilterTypes={false}
    />
  )
}
