import { isSameDay } from 'date-fns'
import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'
import type { UpcomingItem } from '../lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Full view of one calendar day, opened by clicking a date cell. Rows open
 *  the full event detail dialog. */
export function DayEventsDialog({
  date,
  events,
  onOpenChange,
  onOpenEvent,
}: {
  date: Date | null
  events: CalendarEvent<UpcomingItem>[]
  onOpenChange: (open: boolean) => void
  onOpenEvent: (item: UpcomingItem) => void
}) {
  const dayEvents = date
    ? events.filter((e) => isSameDay(e.start, date))
    : []

  return (
    <Dialog open={date !== null} onOpenChange={onOpenChange}>
      {date && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {date.toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </DialogTitle>
            <DialogDescription>
              {dayEvents.length === 0
                ? 'No events'
                : dayEvents.length === 1
                  ? '1 event'
                  : `${dayEvents.length} events`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {dayEvents.map((e) => {
              const it = e.data
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => it && onOpenEvent(it)}
                  className="hover:bg-muted/50 flex w-full items-center gap-3 rounded-lg border p-2.5 text-left"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: e.color ?? 'var(--color-primary)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="text-muted-foreground block truncate text-sm">
                      {it
                        ? [
                            it.kind === 'holiday' ? 'Holiday' : it.contact_name,
                            it.type
                              ? it.type.charAt(0).toUpperCase() + it.type.slice(1)
                              : undefined,
                            it.pawukon,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : ''}
                    </span>
                  </span>
                  {it && (
                    <span className="shrink-0">
                      {it.days_until <= 0 ? (
                        <Badge className="bg-destructive text-white">TODAY</Badge>
                      ) : (
                        <Badge variant="outline">D-{it.days_until}</Badge>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
