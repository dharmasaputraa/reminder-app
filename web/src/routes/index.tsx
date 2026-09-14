import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { api, type UpcomingItem } from '../lib/api'
import { pageTitle } from '../lib/page-title'
import {
  CalendarSettingsButton,
  CALENDAR_LOCALES,
  CALENDAR_TIME_ZONES,
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from '@/components/calendar-settings-button'
import { CalendarDateSelectorButton } from '@/components/calendar-date-selector-button'
import { DayEventsDialog } from '@/components/day-events-dialog'
import { EventDetailDialog } from '@/components/event-detail-dialog'
import { EventCalendar } from '@/components/reui/event-calendar/event-calendar'
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
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'

export const Route = createFileRoute('/')({
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

/** API titles are emoji-free (emoji live only in the notify path), so the
 *  calendar carries its own kind marker. */
function calendarEmoji(it: UpcomingItem): string {
  if (it.kind === 'holiday') return '📅'
  if (it.type === 'otongan') return '🛕'
  if (it.type === 'birthday') return '🎂'
  return '🎊'
}

/** UpcomingItem → reUI CalendarEvent: date-only, so start = end (local midnight).
 *  The whole item rides along in `data` for the click dialogs. */
function toCalendarEvent(it: UpcomingItem, i: number): CalendarEvent<UpcomingItem> {
  const start = localMidnight(it.date)
  const emoji = calendarEmoji(it)
  return {
    id: `${it.kind}-${it.occasion_id ?? it.contact_id ?? 'event'}-${it.date}-${i}`,
    title: it.title.startsWith(emoji) ? it.title : `${emoji} ${it.title}`,
    start,
    end: new Date(start),
    allDay: true,
    color: KIND_COLOR[it.kind],
    data: it,
  }
}

function Dashboard() {
  const up = useUpcoming()
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: unknown[] }>('/channels'),
  })

  const items = up.data?.items ?? []
  const todayYear = up.data?.today ? Number(up.data.today.slice(0, 4)) : new Date().getFullYear()
  // Visible year in the calendar (from navigation); null = never navigated.
  const [visibleYear, setVisibleYear] = useState<number | null>(null)
  const yearAnchor = visibleYear ?? todayYear
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

  // Calendar settings panel (c-event-calendar-1 pattern): one resettable
  // object flowing into <EventCalendar> as controlled props.
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_CALENDAR_SETTINGS)
  const patch = (partial: Partial<CalendarSettings>) =>
    setSettings((current) => ({ ...current, ...partial }))
  // Mirror the active view so the settings panel can show the time-grid
  // internals tab only where those options are visible.
  const [view, setView] = useState<CalendarView>('month')
  const isTimeGridView = view !== 'month' && view !== 'agenda'

  const activeLocale =
    CALENDAR_LOCALES.find((entry) => entry.id === settings.localeId) ?? CALENDAR_LOCALES[0]
  const activeTimeZone =
    CALENDAR_TIME_ZONES.find((entry) => entry.id === settings.timeZoneId) ??
    CALENDAR_TIME_ZONES[0]

  // Click targets: an empty date cell → the day's full view; an event chip →
  // its detail modal (preventDefault opts out of the built-in selection).
  const [dayDialogDate, setDayDialogDate] = useState<Date | null>(null)
  const [detailItem, setDetailItem] = useState<UpcomingItem | null>(null)

  if (up.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[560px] w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    )
  if (up.isError) return <p className="text-red-600">{String(up.error)}</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Calendar</h1>
        <Link to="/contacts" className="text-sm text-indigo-600 hover:underline">Manage Contacts</Link>
      </div>

      {channels.data && channels.data.channels.length === 0 && (
        <Alert>
          <AlertTitle>No notification channels yet</AlertTitle>
          <AlertDescription>
            Add one so reminders actually get delivered —{' '}
            <Link to="/channels" className="underline">add channel</Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-xl border bg-card" dir={activeLocale.dir}>
        <EventCalendar
          events={events}
          defaultView="month"
          views={['month', 'agenda']}
          onViewChange={setView}
          defaultDate={up.data?.today ? localMidnight(up.data.today) : new Date()}
          locale={activeLocale.locale}
          i18n={activeLocale.i18n}
          timeZone={activeTimeZone.value}
          viewSettings={settings.viewSettings}
          onViewSettingsChange={(viewSettings) => patch({ viewSettings })}
          interactions={settings.interactions}
          onInteractionsChange={(interactions) => patch({ interactions })}
          weekStartsOn={settings.weekStartsOn}
          dayStartHour={settings.dayStartHour}
          dayEndHour={settings.dayEndHour}
          interval={settings.interval}
          snapDuration={settings.snapDuration}
          eventTooltip={settings.eventTooltip}
          showDayAddButton={settings.showDayAddButton}
          offDays
          onDateChange={(d) => setVisibleYear(d.getFullYear())}
          onSlotClick={(slot) => setDayDialogDate(slot.date)}
          onEventClick={(occurrence, e) => {
            e.preventDefault()
            if (occurrence.event.data) setDetailItem(occurrence.event.data)
          }}
          className="h-[560px] w-full"
        >
          <div className="flex flex-wrap items-center gap-2 pe-2">
            <EventCalendarNav className="min-w-0 flex-1">
              <TooltipProvider delay={600} closeDelay={0} timeout={300}>
                <EventCalendarNavToday />
                <EventCalendarViewSwitcher />
                <CalendarDateSelectorButton />
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
              <CalendarSettingsButton
                settings={settings}
                onPatch={patch}
                isTimeGridView={isTimeGridView}
              />
            </EventCalendarToolbar>
          </div>
          <EventCalendarContent />
        </EventCalendar>
      </div>

      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-muted-foreground">No events in the next 30 days.</p>
        )}

        {items.map((it: UpcomingItem, i: number) => (
          <Card key={`${it.kind}-${it.occasion_id ?? it.title}-${i}`}
            className="flex-row items-center gap-3 p-3">
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
          </Card>
        ))}
      </div>

      <DayEventsDialog
        date={dayDialogDate}
        events={events}
        onOpenChange={(open) => {
          if (!open) setDayDialogDate(null)
        }}
        onOpenEvent={(it) => {
          setDayDialogDate(null)
          setDetailItem(it)
        }}
      />
      <EventDetailDialog
        item={detailItem}
        onOpenChange={(open) => {
          if (!open) setDetailItem(null)
        }}
      />
    </div>
  )
}
