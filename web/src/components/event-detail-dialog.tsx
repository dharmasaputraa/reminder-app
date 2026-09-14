import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import type { UpcomingItem } from '../lib/api'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

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

/** Full detail view for one upcoming item, opened by clicking its event
 *  chip on the calendar (or a row in the day dialog). Read-only: occasions
 *  are managed on the contact page. */
export function EventDetailDialog({
  item,
  onOpenChange,
}: {
  item: UpcomingItem | null
  onOpenChange: (open: boolean) => void
}) {
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
                  to="/contacts/$id"
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
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
