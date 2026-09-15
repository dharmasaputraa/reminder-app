import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api, type Channel, type UpcomingItem } from '../lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DetailRow } from '@/components/panel-section'
import { ChevronDownIcon, SendIcon } from 'lucide-react'

/** Whole days between today's local midnight and an ISO date — negative in
 *  the past. Recomputed from the occurrence date instead of trusting the
 *  API's days_until, which only means something for upcoming items and
 *  collapses every past occurrence into <= 0. */
function daysFromToday(date: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((Date.parse(`${date}T00:00:00`) - today.getTime()) / 86_400_000)
}

/** Countdown badge for one occurrence: "today", "in Nd", "Nd ago" — past
 *  events only badge within the first week, then the badge disappears. */
export function CountdownBadge({ date, className }: { date: string; className?: string }) {
  const days = daysFromToday(date)
  if (days < -7) return null
  const label =
    days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${-days}d ago`
  return (
    <Badge
      variant={days >= 0 && days <= 7 ? 'warning-outline' : 'secondary'}
      className={className}
    >
      {label}
    </Badge>
  )
}

/** Local midnight — avoids the UTC offset shift of `new Date("YYYY-MM-DD")`. */
export function localMidnight(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

/**
 * "Reminders" value: items inheriting the global defaults read
 * "Default (D-7, D-4, …)" Google-Calendar style; custom prefs or per-category
 * holiday offsets render as D-N badges. Empty → em dash.
 */
function RemindersValue({ item }: { item: UpcomingItem }) {
  if (!item.reminders?.length) return <>—</>
  if (item.reminders_default) {
    const offs = [...item.reminders].sort((a, b) => b - a)
    return (
      <span>
        <span className="font-medium">Default</span>
        <span className="text-muted-foreground"> ({offs.map((r) => `D-${r}`).join(', ')})</span>
      </span>
    )
  }
  return (
    <>
      {item.reminders.map((r) => (
        <Badge key={r} variant="secondary" className="me-1">
          D-{r}
        </Badge>
      ))}
    </>
  )
}

/** Facts about one upcoming item, minus reminders — rows only (no wrapper),
 *  so panels can drop them straight into a "Details" section. */
export function EventDetailFacts({ item }: { item: UpcomingItem }) {
  return (
    <>
      <DetailRow label="Kind">
        {item.kind === 'holiday' ? 'Holiday' : 'Occasion'}
      </DetailRow>
      {item.type && (
        <DetailRow label="Type">
          {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
          {item.number ? ` #${item.number}` : ''}
        </DetailRow>
      )}
      {item.contact_id && (
        <DetailRow label="Contact">
          <Link
            to="/reminder/contacts/$id"
            params={{ id: String(item.contact_id) }}
            className="text-indigo-600 hover:underline"
          >
            {item.contact_name ?? 'Open contact'}
          </Link>
        </DetailRow>
      )}
      {item.pawukon && <DetailRow label="Pawukon">{item.pawukon}</DetailRow>}
    </>
  )
}

/** The reminders row on its own, so panels can give it its own section. */
export function EventRemindersRow({ item }: { item: UpcomingItem }) {
  return <DetailRow label="Reminders"><RemindersValue item={item} /></DetailRow>
}

/** Info rows for one upcoming item (no actions). */
export function EventDetailRows({ item }: { item: UpcomingItem }) {
  return (
    <div className="space-y-2.5">
      <EventDetailFacts item={item} />
      <EventRemindersRow item={item} />
    </div>
  )
}

/**
 * The manual "send the reminder now" trigger. One enabled channel → the button
 * IS the trigger; several → the button opens the channel picker, which also
 * has an "all" action. Empty channel_ids = every enabled channel. Takes the
 * minimal notify payload fields so non-Upcoming callers (an occasion row) can
 * use it too; compact renders an icon-only trigger for tight rows.
 */
export function ReminderTrigger({
  kind,
  occasionId,
  contactId,
  date,
  title,
  className,
  variant = 'default',
  compact = false,
}: {
  kind: UpcomingItem['kind']
  /** Required when kind is 'occasion'. */
  occasionId?: number
  /** Required when kind is 'occasion'. */
  contactId?: number
  date: string
  /** Holiday sends match on the title; occasions carry it for completeness. */
  title: string
  className?: string
  variant?: 'default' | 'ghost' | 'outline'
  compact?: boolean
}) {
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: Channel[] }>('/channels'),
  })
  const send = useMutation({
    mutationFn: (channelIds: number[]) =>
      api<{ sent: number; failed: number }>('/upcoming/notify', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          occasion_id: occasionId,
          contact_id: contactId,
          date,
          title,
          channel_ids: channelIds,
        }),
      }),
    onSuccess: (res) => {
      const n = `channel${res.sent === 1 ? '' : 's'}`
      if (res.failed > 0) {
        toast.warning(`Reminder sent to ${res.sent} ${n}, ${res.failed} failed.`)
      } else {
        toast.success(`Reminder sent to ${res.sent} ${n}.`)
      }
    },
    onError: (e) => toast.error(`Send failed: ${String(e)}`),
  })

  const enabledChannels = (channels.data?.channels ?? []).filter((c) => c.enabled)

  if (enabledChannels.length === 0) return null

  if (enabledChannels.length === 1) {
    return (
      <Button
        variant={variant}
        className={className}
        aria-label={compact ? `Remind now — ${title}` : undefined}
        onClick={() => send.mutate([enabledChannels[0].id])}
        disabled={send.isPending}
      >
        <SendIcon aria-hidden="true" className="size-3.5" />
        {!compact && (send.isPending ? 'Sending…' : 'Remind Now')}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            className={className}
            aria-label={compact ? `Remind now — ${title}` : undefined}
            disabled={send.isPending}
          >
            <SendIcon aria-hidden="true" className="size-3.5" />
            {!compact && (
              <>
                {send.isPending ? 'Sending…' : 'Remind Now'}
                <ChevronDownIcon aria-hidden="true" className="ms-0.5 opacity-60" />
              </>
            )}
          </Button>
        }
      />
      {/* min-w overrides the shell's min-w-32 and restores the default anchor
          width: the menu tracks the full-width trigger and only grows */}
      <DropdownMenuContent align="start" className="min-w-(--anchor-width)">
        {enabledChannels.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => send.mutate([c.id])}>
            <span className="truncate">{c.name}</span>
            <span className="text-muted-foreground ms-auto text-xs">{c.type}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => send.mutate([])}>
          <span className="font-medium">All channels</span>
          <span className="text-muted-foreground ms-auto text-xs">
            {enabledChannels.length}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Rows + full-width trigger stacked — the compact detail body used by the
 *  below-lg dialog. The lg panel composes Rows and Trigger itself so it can
 *  pin the trigger to the panel's bottom edge. */
export function EventDetailBody({ item }: { item: UpcomingItem }) {
  return (
    <div className="space-y-4">
      <EventDetailRows item={item} />
      <ReminderTrigger
        kind={item.kind}
        occasionId={item.occasion_id}
        contactId={item.contact_id}
        date={item.date}
        title={item.title}
        className="w-full"
      />
    </div>
  )
}
