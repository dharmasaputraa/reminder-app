import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { addYears } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { ChevronsLeftIcon, ChevronsRightIcon } from 'lucide-react'
import { api, type UpcomingItem } from '../lib/api'
import {
  EventCalendar,
  useEventCalendarNavigation,
} from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content'
import {
  EventCalendarNav,
  EventCalendarNavNext,
  EventCalendarNavPrev,
  EventCalendarNavToday,
  EventCalendarTitle,
  EventCalendarViewSwitcher,
} from '@/components/reui/event-calendar/event-calendar-nav'
import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'

export const Route = createFileRoute('/')({ component: Dashboard })

function useUpcoming(days = 30) {
  return useQuery({
    queryKey: ['upcoming', days],
    queryFn: () => api<{ today: string; items: UpcomingItem[] }>(`/upcoming?days=${days}`),
  })
}

/** Satu query per tahun kalender (±1 tahun di sekitar tahun terlihat).
 *  Payload setahun kecil (puluhan–ratusan item), jadi fetch per tahun lebih
 *  hemat daripada per bulan dan membuat navigasi antar tahun instan. */
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
  if (days <= 0) return 'bg-destructive text-destructive-foreground'
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

/** UpcomingItem → reUI CalendarEvent: date-only, so start = end (local midnight). */
function toCalendarEvent(it: UpcomingItem, i: number): CalendarEvent<{ kind: UpcomingItem['kind'] }> {
  const start = localMidnight(it.date)
  const emoji = calendarEmoji(it)
  return {
    id: `${it.kind}-${it.occasion_id ?? it.contact_id ?? 'event'}-${it.date}-${i}`,
    title: it.title.startsWith(emoji) ? it.title : `${emoji} ${it.title}`,
    start,
    end: new Date(start),
    allDay: true,
    color: KIND_COLOR[it.kind],
    data: { kind: it.kind },
  }
}

const CALENDAR_I18N = {
  labels: {
    today: 'Hari ini',
    previous: 'Sebelumnya',
    next: 'Berikutnya',
    allDay: 'Sepanjang hari',
    more: (count: number) => `+${count} lagi`,
    noEvents: 'Tidak ada acara',
    loading: 'Memuat…',
    event: 'acara',
    events: (count: number) => `${count} acara`,
    selectView: 'Pilih tampilan',
  },
  viewNames: {
    month: 'Bulan',
    week: 'Minggu',
    day: 'Hari',
    days: (count: number) => `${count} hari`,
    agenda: 'Agenda',
    resource: 'Sumber daya',
  },
}

/** Tombol lompat ±1 tahun — harus dirender di dalam <EventCalendar> agar
 *  bisa memakai context navigasinya. */
function YearJumpButton({ dir }: { dir: -1 | 1 }) {
  const { date, goTo } = useEventCalendarNavigation()
  const label = dir === -1 ? 'Tahun sebelumnya' : 'Tahun berikutnya'
  const Icon = dir === -1 ? ChevronsLeftIcon : ChevronsRightIcon
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label}
      onClick={() => goTo(addYears(date, dir))}>
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  )
}

function Dashboard() {
  const up = useUpcoming()
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: unknown[] }>('/channels'),
  })

  const items = up.data?.items ?? []
  const todayYear = up.data?.today ? Number(up.data.today.slice(0, 4)) : new Date().getFullYear()
  // Tahun terlihat di kalender (dari navigasi); null = belum pernah navigasi.
  const [visibleYear, setVisibleYear] = useState<number | null>(null)
  const yearAnchor = visibleYear ?? todayYear
  // ±1 tahun di sekitar anchor di-fetch sekaligus → lompat tahun sudah terisi
  // sebelum diklik (prefetch), dan tiap tahun ter-cache terpisah di react-query.
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
        <h1 className="text-xl font-bold">30 Hari ke Depan</h1>
        <Link to="/contacts" className="text-sm text-indigo-600 hover:underline">Kelola Kontak</Link>
      </div>

      {channels.data && channels.data.channels.length === 0 && (
        <Alert>
          <AlertTitle>Belum ada channel notifikasi</AlertTitle>
          <AlertDescription>
            Tambah dulu supaya pengingat benar-benar terkirim —{' '}
            <Link to="/channels" className="underline">tambah channel</Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <EventCalendar
          events={events}
          defaultView="month"
          views={['month', 'agenda']}
          defaultDate={up.data?.today ? localMidnight(up.data.today) : new Date()}
          weekStartsOn={1}
          interactions={{ drag: false, resize: false, selectSlot: false }}
          locale={localeId}
          i18n={CALENDAR_I18N}
          onDateChange={(d) => setVisibleYear(d.getFullYear())}
          className="h-[560px] w-full"
        >
          <EventCalendarNav>
            <TooltipProvider delay={600} closeDelay={0} timeout={300}>
              <EventCalendarNavToday />
              <EventCalendarViewSwitcher />
              <div className="flex items-center">
                <YearJumpButton dir={-1} />
                <EventCalendarNavPrev />
                <EventCalendarNavNext />
                <YearJumpButton dir={1} />
              </div>
              {/* ms-3 sets the title apart from the tight control cluster so the
                  period reads as its own group, not another button */}
              <EventCalendarTitle className="ms-3" />
              {yearsLoading && <span className="ms-2 text-xs text-slate-400">memuat…</span>}
              <div className="grow" />
            </TooltipProvider>
          </EventCalendarNav>
          <EventCalendarContent />
        </EventCalendar>
      </div>

      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-slate-500">Tidak ada acara dalam 30 hari ke depan.</p>
        )}

        {items.map((it: UpcomingItem, i: number) => (
          <Card key={`${it.kind}-${it.occasion_id ?? it.title}-${i}`}
            className="flex-row items-center gap-3 p-3">
            <Badge className={`h-11 w-11 rounded-full text-xs font-bold ${urgencyClass(it.days_until)}`}>
              {it.days_until <= 0 ? 'HARI H' : `H-${it.days_until}`}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{it.title}</p>
              <p className="truncate text-sm text-slate-500">
                {it.kind === 'holiday' ? 'Hari raya' : it.contact_name} · {it.date}
                {it.pawukon ? ` · ${it.pawukon}` : ''}
              </p>
            </div>
            <div className="hidden shrink-0 gap-1 sm:flex">
              {it.reminders?.map((r) => (
                <Badge key={r} variant="secondary">H-{r}</Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
