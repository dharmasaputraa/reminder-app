import { format } from 'date-fns'
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
import { CountdownBadge, EventDetailBody, localMidnight } from '@/components/event-detail'

/**
 * Mobile / below-lg fallback for the event detail — at lg the agenda side
 * panel carries the same surface, so this only renders when the panel
 * doesn't exist.
 */
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
              <CountdownBadge date={item.date} />
            </div>
            <DialogTitle className="text-left">{item.title}</DialogTitle>
            <DialogDescription className="text-left">
              {format(localMidnight(item.date), 'EEEE, d MMMM yyyy')}
            </DialogDescription>
          </DialogHeader>
          <EventDetailBody item={item} />
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
