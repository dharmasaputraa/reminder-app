import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { id as localeId } from 'date-fns/locale'
import { api, type UpcomingItem } from '../lib/api'
import { EventCalendar } from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content'
import { EventCalendarNav } from '@/components/reui/event-calendar/event-calendar-nav'
import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'

export const Route = createFileRoute('/')({ component: Dashboard })

function useUpcoming(days = 30) {
  return useQuery({
    queryKey: ['upcoming', days],
    queryFn: () => api<{ today: string; items: UpcomingItem[] }>(`/upcoming?days=${days}`),
  })
}

function badgeClass(days: number): string {
  if (days <= 0) return 'bg-red-500'
  if (days <= 3) return 'bg-orange-500'
  if (days <= 7) return 'bg-amber-400'
  return 'bg-slate-400'
}

/** Local midnight — avoids the UTC offset shift of `new Date("YYYY-MM-DD")`. */
function localMidnight(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

const KIND_COLOR: Record<UpcomingItem['kind'], string> = {
  occasion: 'var(--color-indigo-500)',
  holiday: 'var(--color-amber-500)',
}

/** UpcomingItem → reUI CalendarEvent: date-only, so start = end (local midnight). */
function toCalendarEvent(it: UpcomingItem, i: number): CalendarEvent<{ kind: UpcomingItem['kind'] }> {
  const start = localMidnight(it.date)
  return {
    id: `${it.kind}-${it.occasion_id ?? it.contact_id ?? 'event'}-${it.date}-${i}`,
    title: it.title,
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

function Dashboard() {
  const up = useUpcoming()
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: unknown[] }>('/channels'),
  })

  const items = up.data?.items ?? []
  const events = useMemo(() => (up.data?.items ?? []).map(toCalendarEvent), [up.data])

  if (up.isLoading) return <p className="text-slate-500">Memuat…</p>
  if (up.isError) return <p className="text-red-600">{String(up.error)}</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">30 Hari ke Depan</h1>
        <Link to="/contacts" className="text-sm text-indigo-600 hover:underline">Kelola Kontak</Link>
      </div>

      {channels.data && channels.data.channels.length === 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Belum ada channel notifikasi — <Link to="/channels" className="underline">tambah dulu</Link> supaya pengingat benar-benar terkirim.
        </div>
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
          className="h-[560px] w-full"
        >
          <EventCalendarNav />
          <EventCalendarContent />
        </EventCalendar>
      </div>

      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-slate-500">Tidak ada acara dalam 30 hari ke depan.</p>
        )}

        {items.map((it: UpcomingItem, i: number) => (
          <div key={`${it.kind}-${it.occasion_id ?? it.title}-${i}`}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${badgeClass(it.days_until)}`}>
              {it.days_until <= 0 ? 'HARI H' : `H-${it.days_until}`}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{it.title}</p>
              <p className="truncate text-sm text-slate-500">
                {it.kind === 'holiday' ? 'Hari raya' : it.contact_name} · {it.date}
                {it.pawukon ? ` · ${it.pawukon}` : ''}
              </p>
            </div>
            {it.reminders && (
              <div className="hidden shrink-0 gap-1 sm:flex">
                {it.reminders.map((r) => (
                  <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">H-{r}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
