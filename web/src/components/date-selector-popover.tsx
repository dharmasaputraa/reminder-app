import { useEffect, useState } from "react"
import {
  DateSelector,
  formatDateValue,
  type DateSelectorValue,
} from "@/components/reui/date-selector"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { CalendarIcon } from "lucide-react"

/**
 * The `DateSelector` value is period-shaped (a day, a month, a quarter, a
 * half-year or a whole year — possibly a range). Resolve it to the date that
 * anchors the period: its first day.
 */
export function dateSelectorValueToDate(
  value: DateSelectorValue | undefined
): Date | undefined {
  if (!value) return undefined
  if (value.period === "day") return value.startDate
  if (value.rangeStart) {
    const { year, value: v } = value.rangeStart
    if (value.period === "month") return new Date(year, v, 1)
    if (value.period === "quarter") return new Date(year, v * 3, 1)
    if (value.period === "half-year") return new Date(year, v * 6, 1)
  }
  if (value.year === undefined) return undefined
  if (value.period === "month") return new Date(value.year, value.month ?? 0, 1)
  if (value.period === "quarter")
    return new Date(value.year, (value.quarter ?? 0) * 3, 1)
  if (value.period === "half-year")
    return new Date(value.year, (value.halfYear ?? 0) * 6, 1)
  return new Date(value.year, 0, 1)
}

/**
 * Popover date picker, from the reUI `c-date-selector-2` example: the full
 * DateSelector (all period types, ranges, text input) behind a trigger
 * button, with an explicit draft -> Apply/Cancel commit.
 */
export function DateSelectorPopover({
  value,
  onApply,
  placeholder = "Select a date",
  label,
  inputHint = "Try: 2025, Q4, 05/10/2025",
  minYear,
  maxYear,
  weekStartsOn,
  className = "w-56 justify-start",
}: {
  value: DateSelectorValue | undefined
  onApply: (value: DateSelectorValue | undefined) => void
  placeholder?: string
  label?: string
  inputHint?: string
  minYear?: number
  maxYear?: number
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [internalValue, setInternalValue] = useState<
    DateSelectorValue | undefined
  >(value)

  const formattedValue = value ? formatDateValue(value) : ""
  const displayText = formattedValue || placeholder

  useEffect(() => {
    if (open) {
      setInternalValue(value)
    }
  }, [open, value])

  const handleApply = () => {
    onApply(internalValue)
    setOpen(false)
  }

  const handleCancel = () => {
    setInternalValue(value)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className={className}>
            <CalendarIcon />
            {displayText}
          </Button>
        }
      />
      <PopoverContent className="w-auto gap-3 p-0" align="start" sideOffset={4}>
        <div className="p-3">
          <DateSelector
            value={internalValue}
            onChange={setInternalValue}
            allowRange={true}
            label={label}
            inputHint={inputHint}
            minYear={minYear}
            maxYear={maxYear}
            weekStartsOn={weekStartsOn}
          />
        </div>
        <Separator className="p-0" />
        <div className="flex justify-end gap-2 p-3 pt-0">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
