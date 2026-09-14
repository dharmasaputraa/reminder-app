import { useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { api, type UpcomingItem } from '../lib/api'
import { pageTitle } from '../lib/page-title'
import {
  validateReminderSearch,
  type ReminderSearch,
} from '../lib/reminder-search'
import {
  CalendarSettingsButton,
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from '@/components/calendar-settings-button'
import { CalendarDateSelectorButton } from '@/components/calendar-date-selector-button'
import { DayEventsDialog } from '@/components/day-events-dialog'
import { EventDetailDialog } from '@/components/event-detail-dialog'
import { AgendaPanel, contactAvatar } from '@/components/agenda-panel'
import { EventCalendar } from '@/components/reui/event-calendar/event-calendar'
import type { EventCalendarRenderEventProps } from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content'
import {
  EventCalendarNav,
  EventCalendarNavNext,
  EventCalendarNavPrev,
  EventCalendarNavToday,
  EventCalendarTitle,
  EventCalendarToolbar,
  EventCalendarViewSwitcher,
} from '@/components/reui/event-calendar/event-calendar-nav'
import type {
  CalendarEvent,
  CalendarView,
} from '@/components/reui/event-calendar/event-calendar-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChevronRight, PanelRightIcon } from 'lucide-react'
import { useIsLg } from '@/hooks/use-lg'
import { motion } from 'motion/react'

export const Route = createFileRoute('/reminder/')({
  validateSearch: validateReminderSearch,
  component: Dashboard,
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
})

function useUpcoming(days = 30) {
  return useQuery({
    queryKey: ['upcoming', days],
    queryFn: () => api<{ today: string; items: UpcomingItem[] }>(`/upcoming?days=${days}`),
  })
}

/** One query per calendar year (±1 year around the visible year).
 *  A year's payload is small (tens–hundreds of items), so fetching per year is
 *  cheaper than per month and makes year-to-year navigation instant. */
function useUpcomingYears(years: number[]) {
  return useQueries({
    queries: years.map((y) => ({
      queryKey: ['upcoming-year', y],
      queryFn: () =>
        api<{ today: string; items: UpcomingItem[] }>(`/upcoming?from=${y}-01-01&to=${y}-12-31`),
    })),
  })
}

function urgencyClass(days: number): string {
  if (days <= 0) return 'bg-destructive text-white'
  if (days <= 3) return 'bg-warning text-warning-foreground'
  if (days <= 7) return 'bg-amber-400 text-amber-950'
  return 'bg-muted text-muted-foreground'
}

/** Local midnight — avoids the UTC offset shift of `new Date("YYYY-MM-DD")`. */
function localMidnight(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

const KIND_COLOR: Record<UpcomingItem['kind'], string> = {
  occasion: 'var(--color-indigo-500)',
  holiday: 'var(--color-amber-500)',
}

/** UpcomingItem → reUI CalendarEvent: date-only, so start = end (local midnight).
 *  The whole item rides along in `data` for the click dialogs. */
function toCalendarEvent(it: UpcomingItem, i: number): CalendarEvent<UpcomingItem> {
  const start = localMidnight(it.date)
  return {
    id: `${it.kind}-${it.occasion_id ?? it.contact_id ?? 'event'}-${it.date}-${i}`,
    title: it.title,
    start,
    end: new Date(start),
    allDay: true,
    color: KIND_COLOR[it.kind],
    data: it,
  }
}

/** Contact avatar in place of the leading dot on occasion chips, the
 *  c-event-calendar-1 way; returning undefined keeps the built-in chip for
 *  holidays. Applies to month cells and the "+N more" popover. */
function renderEventContent({
  occurrence,
}: EventCalendarRenderEventProps<UpcomingItem>) {
  const it = occurrence.event.data
  if (!it || it.kind !== 'occasion' || !it.contact_name) return undefined
  return (
    <>
      {contactAvatar(it)}
      <span className="truncate font-medium">{occurrence.event.title}</span>
    </>
  )
}

function Dashboard() {
  const up = useUpcoming()
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: unknown[] }>('/channels'),
  })

  const todayYear = up.data?.today ? Number(up.data.today.slice(0, 4)) : new Date().getFullYear()
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
  const yearAnchor = visibleDate?.getFullYear() ?? todayYear
  // ±1 year around the anchor is fetched at once → year jumps are already filled
  // before being clicked (prefetch), and each year is cached separately in react-query.
  const yearList = useMemo(
    () => [yearAnchor - 1, yearAnchor, yearAnchor + 1],
    [yearAnchor]
  )
  const yearQueries = useUpcomingYears(yearList)
  const calendarItems = useMemo(
    () => yearQueries.flatMap((q) => q.data?.items ?? []),
    [yearQueries]
  )
  const events = useMemo(() => calendarItems.map(toCalendarEvent), [calendarItems])
  const yearsLoading = yearQueries.some((q) => q.isLoading)

  // The side agenda (and the card list below lg) shows the events of the month
  // currently displayed on the calendar, sorted by date.
  const visibleMonth = visibleDate ?? (up.data?.today ? localMidnight(up.data.today) : new Date())
  const monthEvents = useMemo(
    () =>
      events
        .filter(
          (e) =>
            e.start.getFullYear() === visibleMonth.getFullYear() &&
            e.start.getMonth() === visibleMonth.getMonth()
        )
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [events, visibleMonth]
  )

  // Calendar settings panel (c-event-calendar-1 pattern): one resettable
  // object flowing into <EventCalendar> as controlled props.
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_CALENDAR_SETTINGS)
  const patch = (partial: Partial<CalendarSettings>) =>
    setSettings((current) => ({ ...current, ...partial }))
  // Mirror the active view so the settings panel can show the time-grid
  // internals tab only where those options are visible.
  const [view, setView] = useState<CalendarView>('month')
  const isTimeGridView = view !== 'month' && view !== 'agenda'
  // lg+ pairs the calendar with the side agenda (switchable, but the main
  // calendar is pinned to month there); below lg the view switcher returns.
  const isLg = useIsLg()
  const [agendaOpen, setAgendaOpen] = useState(true)
  // Folded agenda day groups (key = event-start ms).
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const agendaRef = useRef<HTMLDivElement | null>(null)

  // Click targets: at lg both land in the side agenda — an event chip opens the
  // detail surface, a day click scrolls the agenda to that day. Below lg the
  // same clicks keep using the dialogs (the agenda panel doesn't exist there).
  const [dayDialogDate, setDayDialogDate] = useState<Date | null>(null)
  const [detailItem, setDetailItem] = useState<UpcomingItem | null>(null)
  const [dialogDetail, setDialogDetail] = useState<UpcomingItem | null>(null)

  const openDetail = (it: UpcomingItem) => {
    if (isLg) {
      setDetailItem(it)
      setAgendaOpen(true)
    } else {
      setDialogDetail(it)
    }
  }

  /** Scroll the agenda list to a day's group, unfolding it first if needed.
   *  Days without events have no group, so this is a no-op for them. */
  const scrollAgendaToDay = (day: Date) => {
    const root = agendaRef.current
    if (!root) return
    const key = String(day.getTime())
    const wasCollapsed = collapsedDays.has(key)
    if (wasCollapsed) {
      const next = new Set(collapsedDays)
      next.delete(key)
      setCollapsedDays(next)
    }
    const scroll = () => {
      const viewport = root.querySelector('[data-agenda-scroll]')
      const target = root.querySelector(`[data-day="${key}"]`)
      if (!viewport || !target) return
      const vp = viewport.getBoundingClientRect()
      const tg = target.getBoundingClientRect()
      viewport.scrollTo({ top: viewport.scrollTop + (tg.top - vp.top) - 2, behavior: 'smooth' })
    }
    if (wasCollapsed) setTimeout(scroll, 240) // let the unfold tween finish
    else requestAnimationFrame(scroll)
  }

  if (up.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[720px] w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    )
  if (up.isError) return <p className="text-red-600">{String(up.error)}</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Calendar</h1>
        <Link to="/reminder/contacts" className={buttonVariants({ size: 'sm' })}>
          Manage Contacts
        </Link>
      </div>

      {channels.data && channels.data.channels.length === 0 && (
        <Alert>
          <AlertTitle>No notification channels yet</AlertTitle>
          <AlertDescription>
            Add one so reminders actually get delivered —{' '}
            <Link to="/reminder/channels" className="underline">add channel</Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <EventCalendar
            events={events}
            // At lg the agenda lives in the side panel, so the main calendar is
            // pinned to month; below lg the switcher (and agenda view) returns.
            view={isLg ? 'month' : view}
            views={['month', 'agenda']}
            onViewChange={setView}
            date={visibleDate ?? undefined}
            defaultDate={up.data?.today ? localMidnight(up.data.today) : new Date()}
            viewSettings={settings.viewSettings}
            onViewSettingsChange={(viewSettings) => patch({ viewSettings })}
            interactions={{ drag: false, resize: false, selectSlot: false }}
            weekStartsOn={settings.weekStartsOn}
            dayStartHour={settings.dayStartHour}
            dayEndHour={settings.dayEndHour}
            interval={settings.interval}
            snapDuration={settings.snapDuration}
            eventTooltip={settings.eventTooltip}
            offDays
            renderEvent={renderEventContent}
            onDateChange={setMonthParam}
            onSlotClick={(slot) => {
              if (isLg) {
                // back to the list, then glide to the clicked day
                setDetailItem(null)
                setAgendaOpen(true)
                scrollAgendaToDay(slot.date)
              } else {
                setDayDialogDate(slot.date)
              }
            }}
            onEventClick={(occurrence, e) => {
              e.preventDefault()
              if (occurrence.event.data) openDetail(occurrence.event.data)
            }}
            // Two event rows per cell, "+N more" beyond that; the calendar height
            // below is sized so 2 lanes + the "+N more" chip + the day number fit
            // even in a 6-week month.
            maxEventsPerCell={2}
            className="h-[720px] w-full"
          >
            <div className="flex flex-wrap items-center gap-2 pe-2">
              <EventCalendarNav className="min-w-0 flex-1">
                <TooltipProvider delay={600} closeDelay={0} timeout={300}>
                  <EventCalendarNavToday />
                  {/* the side agenda owns the agenda at lg, so its switcher
                      would be a dead end there */}
                  <div className="lg:hidden">
                    <EventCalendarViewSwitcher />
                  </div>
                  <div className="flex items-center">
                    <EventCalendarNavPrev />
                    <EventCalendarNavNext />
                  </div>
                  {/* ms-3 sets the title apart from the tight control cluster so the
                      period reads as its own group, not another button */}
                  <EventCalendarTitle className="ms-3" />
                  {yearsLoading && <span className="ms-2 text-xs text-muted-foreground">loading…</span>}
                  <div className="grow" />
                </TooltipProvider>
              </EventCalendarNav>
              <EventCalendarToolbar>
                <CalendarDateSelectorButton />
                <CalendarSettingsButton
                  settings={settings}
                  onPatch={patch}
                  isTimeGridView={isTimeGridView}
                />
                {/* lg-only: collapse/expand the side agenda */}
                <Button
                  variant={agendaOpen ? 'secondary' : 'outline'}
                  size="icon-sm"
                  aria-label="Toggle agenda panel"
                  aria-pressed={agendaOpen}
                  onClick={() => setAgendaOpen((o) => !o)}
                  className="hidden lg:inline-flex"
                >
                  <PanelRightIcon aria-hidden="true" />
                </Button>
              </EventCalendarToolbar>
            </div>
            <EventCalendarContent />
          </EventCalendar>
        </div>
        {/* lg+ replaces the card list below: the agenda/detail panel sits
            alongside, pinned to the month the calendar is showing. Collapsible
            via the toolbar's panel button; the collapse is animated — width +
            opacity tween, while the fixed-width inner keeps the panel from
            squishing mid-transition. The container's lg gap lives on the
            animated marginLeft so a collapsed panel leaves no dead space. */}
        <motion.aside
          ref={agendaRef}
          aria-label="Agenda"
          aria-hidden={!agendaOpen}
          initial={false}
          animate={{
            width: agendaOpen ? 'auto' : 0,
            opacity: agendaOpen ? 1 : 0,
            marginLeft: agendaOpen ? 16 : 0,
          }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="hidden h-[560px] shrink-0 overflow-hidden rounded-xl border bg-card lg:block"
        >
          <div className="h-full w-[280px] xl:w-[340px]">
            <AgendaPanel
              events={monthEvents}
              month={visibleMonth}
              detailItem={detailItem}
              onBack={() => setDetailItem(null)}
              collapsedDays={collapsedDays}
              onToggleDay={(key) =>
                setCollapsedDays((prev) => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              onOpenEvent={openDetail}
            />
          </div>
        </motion.aside>
      </div>

      <div className="space-y-3 lg:hidden">
        {monthEvents.length === 0 && (
          <p className="text-muted-foreground">No event at this month.</p>
        )}

        {monthEvents.map((e) => {
          const it = e.data
          if (!it) return null
          const open = () => openDetail(it)
          return (
            <Card
              key={e.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${it.title}`}
              onClick={open}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  open()
                }
              }}
              className="flex-row items-center gap-3 p-3 text-left transition-colors outline-none cursor-pointer hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Badge className={`h-11 w-11 rounded-full text-xs font-bold ${urgencyClass(it.days_until)}`}>
                {it.days_until <= 0 ? 'TODAY' : `D-${it.days_until}`}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{it.title}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {it.kind === 'holiday' ? 'Holiday' : it.contact_name} · {it.date}
                  {it.pawukon ? ` · ${it.pawukon}` : ''}
                </p>
              </div>
              <div className="hidden shrink-0 gap-1 sm:flex">
                {it.reminders?.map((r) => (
                  <Badge key={r} variant="secondary">D-{r}</Badge>
                ))}
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Card>
          )
        })}
      </div>

      {/* Below lg the side agenda doesn't exist, so the dialogs stay. */}
      {!isLg && (
        <>
          <DayEventsDialog
            date={dayDialogDate}
            events={events}
            onOpenChange={(open) => {
              if (!open) setDayDialogDate(null)
            }}
            onOpenEvent={(it) => {
              setDayDialogDate(null)
              openDetail(it)
            }}
          />
          <EventDetailDialog
            item={dialogDetail}
            onOpenChange={(open) => {
              if (!open) setDialogDetail(null)
            }}
          />
        </>
      )}
    </div>
  )
}
