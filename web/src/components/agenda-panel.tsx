import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { format } from 'date-fns'
import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'
import type { UpcomingItem } from '../lib/api'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import {
  CountdownBadge,
  EventDetailFacts,
  EventRemindersRow,
  ReminderTrigger,
  localMidnight,
} from '@/components/event-detail'
import { PanelSection } from '@/components/panel-section'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { IconStack } from '@/components/reui/icon-stack'
import {
  CalendarIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  XIcon,
} from 'lucide-react'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** Contact avatar for occasion rows/chips — same plain style as the contacts
 *  page; holidays fall back to a color dot. Size overridable: the agenda rows
 *  use a larger one than the calendar chips. */
export function contactAvatar(
  it: UpcomingItem,
  className = 'size-4',
  fallbackClassName = 'text-[8px]',
) {
  if (it.kind !== 'occasion' || !it.contact_name) {
    return (
      <span
        aria-hidden
        className="bg-(--ec-event-color,--color-primary) size-2.5 shrink-0 rounded-full"
      />
    )
  }
  return (
    <Avatar className={cn('shrink-0', className)}>
      <AvatarFallback className={fallbackClassName}>{initials(it.contact_name)}</AvatarFallback>
    </Avatar>
  )
}

function typeLabel(it: UpcomingItem): string {
  return it.type ? it.type.charAt(0).toUpperCase() + it.type.slice(1) : 'Event'
}

/** Occasions read "{Type} #{years/married}" (e.g. "Anniversary #32"); holidays
 *  keep their name. */
export function eventDisplayTitle(it: UpcomingItem): string {
  if (it.kind === 'occasion' && it.number !== null && it.number !== undefined) {
    return `${typeLabel(it)} #${it.number}`
  }
  return it.title
}

/** The event's own avatar: the contact's for occasions, the calendar-icon
 *  avatar for holidays and contact-less occasions — one leading element per
 *  row and for the detail identity block, so everything aligns. */
function eventAvatar(
  it: UpcomingItem,
  className: string,
  fallbackClassName: string,
  iconClassName: string,
) {
  if (it.kind === 'occasion' && it.contact_name) {
    return contactAvatar(it, className, fallbackClassName)
  }
  return (
    <Avatar className={className}>
      <AvatarFallback className={fallbackClassName}>
        <CalendarIcon aria-hidden="true" className={iconClassName} />
      </AvatarFallback>
    </Avatar>
  )
}

interface AgendaPanelProps {
  /** Events of the month the calendar is showing, sorted by start. */
  events: CalendarEvent<UpcomingItem>[]
  /** The month the calendar is showing — drives the panel title. */
  month: Date
  /** When set, the panel slides to the event detail surface. */
  detailItem: UpcomingItem | null
  onBack: () => void
  /** Day keys (event-start ms) whose groups are folded. */
  collapsedDays: Set<string>
  onToggleDay: (key: string) => void
  /** Fold/unfold every day group at once (header button). */
  onSetAllCollapsed: (collapsed: boolean) => void
  onOpenEvent: (item: UpcomingItem) => void
}

/**
 * The right-side panel content at lg: a titled card with the month's agenda,
 * grouped per day with collapsible groups, plus an event-detail surface that
 * slides over it. The detail carries the contacts docked panel's anatomy —
 * h-11 title bar with a dismiss action, centered identity block, hairline
 * sections, pinned action footer — so both right panels read the same.
 * Both layers stay mounted so the agenda keeps its scroll position and
 * collapse state while the detail is open.
 */
export function AgendaPanel({
  events,
  month,
  detailItem,
  onBack,
  collapsedDays,
  onToggleDay,
  onSetAllCollapsed,
  onOpenEvent,
}: AgendaPanelProps) {
  const groups = useMemo(() => {
    const byKey = new Map<string, { key: string; date: Date; items: CalendarEvent<UpcomingItem>[] }>()
    for (const e of events) {
      if (!e.data) continue
      const key = String(e.start.getTime())
      const g = byKey.get(key) ?? { key, date: e.start, items: [] }
      g.items.push(e)
      byKey.set(key, g)
    }
    return [...byKey.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [events])

  // Command shows the action it performs: fold everything while any day is
  // open, unfold everything once all are folded.
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsedDays.has(g.key))

  return (
    <div className="relative h-full text-sm">
      {/* Underlying surface — header + agenda list. Inert while the detail
          layer covers it, so the collapse-all button needs no disabled
          state: it is simply unreachable until the detail slides away. */}
      <div className="flex h-full flex-col" inert={!!detailItem}>
      {/* Panel title bar — same height as the calendar's toolbar row (h-11) */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="font-semibold">Agenda</span>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-xs font-medium tabular-nums">
            {format(month, 'MMMM yyyy')}
          </span>
          {groups.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-me-1.5"
              aria-label={allCollapsed ? 'Expand all days' : 'Collapse all days'}
              onClick={() => onSetAllCollapsed(!allCollapsed)}
            >
              {allCollapsed ? (
                <ChevronsUpDownIcon aria-hidden="true" />
              ) : (
                <ChevronsDownUpIcon aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
      {/* Agenda list layer — the wrapper's inert covers a11y; invisible
          keeps the slide-in from ghosting over the list */}
      <div
        data-agenda-scroll
        className={cn('absolute inset-0 overflow-y-auto', detailItem && 'invisible')}
      >
        {groups.length === 0 && (
          <div
            data-slot="event-calendar-no-events"
            className="flex min-h-72 flex-col items-center justify-center gap-4 py-16"
          >
            <IconStack>
              <CalendarIcon className="size-5" aria-hidden="true" />
            </IconStack>
            <span className="text-muted-foreground text-sm">No events</span>
          </div>
        )}
        {groups.map((g) => {
          const collapsed = collapsedDays.has(g.key)
          return (
            <div key={g.key} role="group" data-day={g.key}>
              {/* Day bar — the list layer's sticky muted group header */}
              <button
                type="button"
                onClick={() => onToggleDay(g.key)}
                aria-expanded={!collapsed}
                className="bg-muted sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b px-4 py-1.5 text-start"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRightIcon
                    aria-hidden="true"
                    className={cn(
                      'text-muted-foreground size-3.5 shrink-0 transition-transform',
                      !collapsed && 'rotate-90',
                    )}
                  />
                  <span className="truncate font-semibold">{format(g.date, 'EEEE')}</span>
                  <span aria-hidden className="text-muted-foreground">-</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {format(g.date, 'd')}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">
                  {g.items.length} event{g.items.length === 1 ? '' : 's'}
                </span>
              </button>
              <motion.div
                initial={false}
                animate={{ height: collapsed ? 0 : 'auto', opacity: collapsed ? 0 : 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
                // height:0 alone leaves the rows focusable and announced; drop
                // them from the a11y tree while folded (same pattern as the
                // panel/detail layers above).
                inert={collapsed}
              >
                {g.items.map((e) => {
                  const it = e.data!
                  const subtitle = it.kind === 'occasion' ? it.contact_name : null
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onOpenEvent(it)}
                      className="hover:bg-accent/40 flex w-full items-center gap-2.5 border-b px-4 py-2 text-start transition-colors"
                    >
                      {eventAvatar(it, 'size-6', 'text-[10px]', 'size-3.5')}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{eventDisplayTitle(it)}</span>
                        {subtitle && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </motion.div>
            </div>
          )
        })}
      </div>
      </div>
      </div>
      {/* Detail layer — sweeps in from the right edge covering the whole
          panel, header included, and slides back out to the right on back,
          revealing the agenda beneath. Chrome mirrors the contacts docked
          panel: h-11 title bar with the dismiss action, centered identity
          block, hairline sections, and the pinned footer. */}
      <AnimatePresence>
        {detailItem && (
          <motion.div
            key={detailItem.kind + detailItem.date + detailItem.title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="bg-card absolute inset-0 z-20 flex flex-col text-sm"
          >
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
              <span className="font-semibold">Event</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to agenda"
                onClick={onBack}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Identity block — the contacts panel's profile header: avatar
                  above a tight title+date group (small inner gap, not the
                  outer gap-2) */}
              <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
                {eventAvatar(detailItem, 'size-16', 'text-lg', 'size-6')}
                <div className="min-w-0 space-y-1">
                  <h2 className="text-pretty text-lg leading-snug font-semibold">
                    {eventDisplayTitle(detailItem)}
                  </h2>
                  <p className="text-muted-foreground">
                    {format(localMidnight(detailItem.date), 'EEEE, d MMMM yyyy')}
                  </p>
                </div>
                {/* Countdown — the contacts panel's badge style ("in 5d" /
                    "today"), computed from the occurrence date so past
                    events read "Nd ago" and disappear after a week */}
                <CountdownBadge date={detailItem.date} />
              </div>
              <PanelSection title="Details">
                <EventDetailFacts item={detailItem} />
              </PanelSection>
              <PanelSection title="Reminders">
                <EventRemindersRow item={detailItem} />
              </PanelSection>
            </div>
            {/* Send trigger pinned to the bottom, full width — the contacts
                panel's pinned action slot */}
            <div className="border-t p-3">
              <ReminderTrigger item={detailItem} className="w-full" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
