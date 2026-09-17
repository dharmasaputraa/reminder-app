import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDaysIcon,
  CakeIcon,
  HeartIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react'
import { api, type Channel, type Contact, type Occasion } from '@/lib/api'
import { longDate, shortDate } from '@/lib/dates'
import { invalidateContactReminders } from '@/lib/prefs'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { AddOccasionForm } from '@/components/contacts/add-occasion-form'
import { OccasionPrefsEditor } from '@/components/contacts/occasion-prefs-editor'
import { ReminderTrigger } from '@/components/event-detail'
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'

/** Per-type icons for the circular row chips; custom/unknown types fall back
 *  to a plain calendar. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  birthday: CakeIcon,
  anniversary: HeartIcon,
  otonan: SparklesIcon,
}

/** Recurrence as human copy for the collapsed row's description line. */
const RECURRENCE_COPY: Record<Occasion['recurrence'], string> = {
  once: 'one-time',
  yearly: 'every year',
  monthly: 'every month',
  anniversary: 'every year + every month',
  otonan: 'every 210 days (Otonan)',
}

/** The occasions list: date-ordered accordion items (collapsed by default),
 *  each wrapped in its own bordered card. Remind-now stays on the collapsed
 *  row, OUTSIDE the accordion trigger so buttons are never nested; the
 *  editor + the delete action live in the expanded content. Adding happens
 *  in a dialog. */
export function OccasionsTab({ contact, channels }: { contact: Contact; channels: Channel[] }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  // Countdown per occasion — shares the grid's ['upcoming','grid'] query, no
  // extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  const delOcc = useMutation({
    mutationFn: (oid: string) => api(`/occasions/${oid}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateContactReminders(qc, contact.id)
      toast.success('Occasion deleted')
    },
    onError: (e) => toast.error(`Failed to delete occasion: ${String(e)}`),
  })

  const addDialog = (
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      {addOpen && (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Add occasion</DialogTitle>
            <DialogDescription className="text-left">
              A birthday, anniversary, or any recurring date — its reminders layer on top of the
              contact defaults.
            </DialogDescription>
          </DialogHeader>
          <AddOccasionForm contactId={contact.id} onSaved={() => setAddOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  )

  if (contact.occasions.length === 0) {
    return (
      <>
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDaysIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No occasions yet</EmptyTitle>
            <EmptyDescription>
              Add a birthday, anniversary, or any recurring date to start getting reminders.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add occasion
            </Button>
          </EmptyContent>
        </Empty>
        {addDialog}
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add occasion
        </Button>
      </div>

      <Accordion className="space-y-2">
        {contact.occasions.map((o) => {
          const up = upcomingByOccasion.get(o.id)
          const TypeIcon = TYPE_ICONS[o.type] ?? CalendarDaysIcon
          return (
            // One bordered card per occasion: header row + editor share the
            // same container. (border + last:border-b beat the primitive's
            // border-b/last:border-b-0 divider styling.)
            <AccordionItem key={o.id} value={o.id} className="rounded-lg border bg-card last:border-b">
              <AccordionHeader className="w-full items-center gap-2 py-2.5 pl-3 pr-2">
                <AccordionTrigger className="min-w-0 flex-1 gap-3 py-0">
                  {/* Circular chip, same avatar idiom as the agenda rows. */}
                  <Avatar size="lg" className="shrink-0">
                    <AvatarFallback>
                      <TypeIcon aria-hidden="true" className="size-5" />
                    </AvatarFallback>
                  </Avatar>
                  <ItemContent>
                    <ItemTitle>
                      <span className="min-w-0 truncate capitalize">{o.type}</span>
                      {o.label && (
                        <span className="min-w-0 truncate text-muted-foreground font-normal">
                          {' '}
                          · {o.label}
                        </span>
                      )}
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {shortDate(o.base_date)} · {RECURRENCE_COPY[o.recurrence]}
                    </ItemDescription>
                  </ItemContent>
                  <span className="flex shrink-0 items-center gap-1">
                    {o.prefs && <Badge variant="outline">Custom</Badge>}
                    {o.prefs?.enabled === false && <Badge variant="warning-outline">Paused</Badge>}
                    {up && (
                      <Badge variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'} className="shrink-0">
                        {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <ItemActions>
                  {/* Remind needs an actual occurrence date: the backend
                      matches `date` exactly, and a base date is not an
                      occurrence for otonan (base+210n). */}
                  {up && (
                    <ReminderTrigger
                      kind="occasion"
                      occasionId={o.id}
                      contactId={contact.id}
                      date={up.date}
                      title={`${contact.name}'s ${o.type}`}
                      variant="ghost"
                      compact
                      className="size-7 justify-center px-0 text-muted-foreground hover:text-foreground"
                    />
                  )}
                </ItemActions>
              </AccordionHeader>
              <AccordionContent>
                <div className="border-t px-3 pb-3 pt-3">
                  <OccasionPrefsEditor contactId={contact.id} occasion={o} channels={channels} />
                  {/* Destructive actions live in the detail, not on the row. */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">
                      Deleting also removes this occasion's reminders.
                    </p>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                            Delete occasion
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {o.type} on {longDate(o.base_date)} will be permanently deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => delOcc.mutate(o.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
      {addDialog}
    </div>
  )
}
