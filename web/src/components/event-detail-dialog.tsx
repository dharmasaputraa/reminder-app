import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { api, type Channel, type UpcomingItem } from '../lib/api'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDownIcon, SendIcon } from 'lucide-react'

/** Local midnight — avoids the UTC offset shift of `new Date("YYYY-MM-DD")`. */
function localMidnight(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  )
}

/** Full detail view for one upcoming item, opened by clicking its event chip
 *  on the calendar, a row in the day dialog, or the month card below it.
 *  Read-only: occasions are managed on the contact page. Carries a manual
 *  "send the reminder now" trigger with a per-channel target picker. */
export function EventDetailDialog({
  item,
  onOpenChange,
}: {
  item: UpcomingItem | null
  onOpenChange: (open: boolean) => void
}) {
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: Channel[] }>('/channels'),
    enabled: item !== null,
  })
  // Empty channel_ids = every enabled channel; a list narrows to those ids.
  const send = useMutation({
    mutationFn: (channelIds: number[]) => {
      if (!item) throw new Error('no event selected')
      return api<{ sent: number; failed: number }>('/upcoming/notify', {
        method: 'POST',
        body: JSON.stringify({
          kind: item.kind,
          occasion_id: item.occasion_id,
          contact_id: item.contact_id,
          date: item.date,
          title: item.title,
          channel_ids: channelIds,
        }),
      })
    },
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

  const triggerButton = (withChevron: boolean) => (
    <Button disabled={send.isPending}>
      <SendIcon aria-hidden="true" />
      {send.isPending ? 'Sending…' : 'Send reminder'}
      {withChevron && (
        <ChevronDownIcon aria-hidden="true" className="ms-0.5 opacity-60" />
      )}
    </Button>
  )

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      {item && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Badge variant={item.kind === 'holiday' ? 'secondary' : 'default'} className="uppercase">
                {item.kind}
              </Badge>
              {item.days_until <= 0 ? (
                <Badge className="bg-destructive text-white">TODAY</Badge>
              ) : (
                <Badge variant="outline">D-{item.days_until}</Badge>
              )}
            </div>
            <DialogTitle className="text-left">{item.title}</DialogTitle>
            <DialogDescription className="text-left">
              {format(localMidnight(item.date), 'EEEE, d MMMM yyyy')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
                  onClick={() => onOpenChange(false)}
                >
                  {item.contact_name ?? 'Open contact'}
                </Link>
              </DetailRow>
            )}
            {item.pawukon && <DetailRow label="Pawukon">{item.pawukon}</DetailRow>}
            <DetailRow label="Reminders">
              {item.reminders?.length
                ? item.reminders.map((r) => (
                    <Badge key={r} variant="secondary" className="me-1">
                      D-{r}
                    </Badge>
                  ))
                : '—'}
            </DetailRow>
          </div>
          <DialogFooter>
            {/* One enabled channel → the button IS the trigger; several → the
                button opens the channel picker, which also has an "all" action. */}
            {enabledChannels.length === 1 && (
              <Button
                onClick={() => send.mutate([enabledChannels[0].id])}
                disabled={send.isPending}
              >
                <SendIcon aria-hidden="true" />
                {send.isPending ? 'Sending…' : 'Send reminder'}
              </Button>
            )}
            {enabledChannels.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={triggerButton(true)} />
                <DropdownMenuContent align="start" className="w-56">
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
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
