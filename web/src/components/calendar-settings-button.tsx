import type {
  EventCalendarViewSettings,
} from "@/components/reui/event-calendar/event-calendar-types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Settings2Icon } from "lucide-react"

/**
 * Calendar settings panel, from the reUI `c-event-calendar-1` example:
 * View / Time grid / Behavior tabs plus "Reset to defaults".
 * The state lives with the consumer, which feeds it back into
 * <EventCalendar> as controlled props.
 */
export interface CalendarSettings {
  viewSettings: EventCalendarViewSettings
  weekStartsOn: 0 | 1
  dayStartHour: number
  dayEndHour: number
  interval: number
  snapDuration: number
  eventTooltip: boolean
}

/** Defaults follow the dashboard's current behavior (Monday week start,
 *  pointer interactions stay off — events are server-derived). */
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  viewSettings: {
    weekends: true,
    weekNumbers: false,
    nowIndicator: true,
    offDays: false,
  },
  weekStartsOn: 1,
  dayStartHour: 0,
  dayEndHour: 24,
  interval: 60,
  snapDuration: 15,
  eventTooltip: false,
}

function SettingsSwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function SettingsSelect({
  id,
  label,
  value,
  options,
  onValueChange,
}: {
  id: string
  label: string
  value: number
  options: Array<{ value: number; label: string }>
  onValueChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Select
        value={String(value)}
        onValueChange={(next) => onValueChange(Number(next))}
      >
        <SelectTrigger id={id} size="sm" className="w-28">
          {/* Base UI's Value renders the raw value string by default; the
              selected option's label reads better for every control here. */}
          <SelectValue>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function CalendarSettingsButton({
  settings,
  onPatch,
  isTimeGridView,
}: {
  settings: CalendarSettings
  onPatch: (partial: Partial<CalendarSettings>) => void
  /** Time-grid internals only exist where an hour track renders. */
  isTimeGridView: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="icon-sm" aria-label="Settings" />}
      >
        <Settings2Icon className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80">
        <Tabs defaultValue="view">
          <TabsList className="w-full">
            <TabsTrigger value="view" className="flex-1">
              View
            </TabsTrigger>
            {/* time-grid internals only exist where an hour track renders, so
                the tab follows the active view */}
            {isTimeGridView && (
              <TabsTrigger value="time" className="flex-1">
                Time grid
              </TabsTrigger>
            )}
            <TabsTrigger value="behavior" className="flex-1">
              Behavior
            </TabsTrigger>
          </TabsList>
          <TabsContent value="view" className="flex flex-col gap-3">
            <SettingsSwitch
              id="ec-set-weekends"
              label="Weekends"
              checked={settings.viewSettings.weekends ?? true}
              onCheckedChange={(weekends) =>
                onPatch({
                  viewSettings: {
                    ...settings.viewSettings,
                    weekends,
                  },
                })
              }
            />
            <SettingsSwitch
              id="ec-set-week-numbers"
              label="Week numbers"
              checked={settings.viewSettings.weekNumbers ?? false}
              onCheckedChange={(weekNumbers) =>
                onPatch({
                  viewSettings: {
                    ...settings.viewSettings,
                    weekNumbers,
                  },
                })
              }
            />
            <SettingsSwitch
              id="ec-set-now"
              label="Now indicator"
              checked={settings.viewSettings.nowIndicator ?? true}
              onCheckedChange={(nowIndicator) =>
                onPatch({
                  viewSettings: {
                    ...settings.viewSettings,
                    nowIndicator,
                  },
                })
              }
            />
            <SettingsSwitch
              id="ec-set-off-days"
              label="Mark off days"
              checked={settings.viewSettings.offDays ?? false}
              onCheckedChange={(offDays) =>
                onPatch({
                  viewSettings: {
                    ...settings.viewSettings,
                    offDays,
                  },
                })
              }
            />
            {/* week start shapes month and week grids alike, so it lives here
                rather than in time-grid internals */}
            <SettingsSelect
              id="ec-set-week-start"
              label="Week starts"
              value={settings.weekStartsOn}
              options={[
                { value: 0, label: "Sunday" },
                { value: 1, label: "Monday" },
              ]}
              onValueChange={(weekStartsOn) =>
                onPatch({ weekStartsOn: weekStartsOn as 0 | 1 })
              }
            />
          </TabsContent>
          <TabsContent value="time" className="flex flex-col gap-3">
            <SettingsSelect
              id="ec-set-day-start"
              label="Day starts"
              value={settings.dayStartHour}
              options={[
                { value: 0, label: "00:00" },
                { value: 6, label: "06:00" },
                { value: 8, label: "08:00" },
              ]}
              onValueChange={(dayStartHour) => onPatch({ dayStartHour })}
            />
            <SettingsSelect
              id="ec-set-day-end"
              label="Day ends"
              value={settings.dayEndHour}
              options={[
                { value: 18, label: "18:00" },
                { value: 20, label: "20:00" },
                { value: 24, label: "24:00" },
              ]}
              onValueChange={(dayEndHour) => onPatch({ dayEndHour })}
            />
            <SettingsSelect
              id="ec-set-interval"
              label="Grid interval"
              value={settings.interval}
              options={[
                { value: 30, label: "30 min" },
                { value: 60, label: "60 min" },
              ]}
              onValueChange={(interval) => onPatch({ interval })}
            />
            <SettingsSelect
              id="ec-set-snap"
              label="Drag snap"
              value={settings.snapDuration}
              options={[
                { value: 5, label: "5 min" },
                { value: 15, label: "15 min" },
                { value: 30, label: "30 min" },
              ]}
              onValueChange={(snapDuration) => onPatch({ snapDuration })}
            />
          </TabsContent>
          <TabsContent value="behavior" className="flex flex-col gap-3">
            <SettingsSwitch
              id="ec-set-tooltip"
              label="Event tooltips"
              checked={settings.eventTooltip}
              onCheckedChange={(eventTooltip) => onPatch({ eventTooltip })}
            />
          </TabsContent>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full"
          onClick={() => onPatch(DEFAULT_CALENDAR_SETTINGS)}
        >
          Reset to defaults
        </Button>
      </PopoverContent>
    </Popover>
  )
}
