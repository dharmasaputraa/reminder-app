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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'

/** Per-type icon tiles; custom/unknown types fall back to a plain calendar. */
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
 *  an add-form toggle, and the empty state. Delete + Remind-now stay on the
 *  collapsed row, OUTSIDE the accordion trigger so buttons are never nested.
 *  The per-occasion reminder editor (OccasionPrefsEditor) only renders in the
 *  expanded content — inherit occasions stay visually quiet. */
export function OccasionsTab({ contact, channels }: { contact: Contact; channels: Channel[] }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  // Countdown per occasion — shares the grid's ['upcoming','grid'] query, no
  // extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  const delOcc = useMutation({
    mutationFn: (oid: string) => api(`/occasions/${oid}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to delete occasion: ${String(e)}`),
  })

  if (contact.occasions.length === 0 && !adding) {
    return (
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
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            Add occasion
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add occasion
        </Button>
      </div>
      {adding && <AddOccasionForm contactId={contact.id} />}

      <Accordion>
        {contact.occasions.map((o) => {
          const up = upcomingByOccasion.get(o.id)
          const TypeIcon = TYPE_ICONS[o.type] ?? CalendarDaysIcon
          return (
            <AccordionItem key={o.id} value={o.id}>
              <AccordionHeader className="items-center gap-1 pr-2">
                <AccordionTrigger className="min-w-0">
                  <ItemMedia variant="icon" className="size-8 rounded-lg">
                    <TypeIcon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate capitalize">
                      {o.type}
                      {o.label && (
                        <span className="text-muted-foreground font-normal"> · {o.label}</span>
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
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${o.type} occasion`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2Icon aria-hidden="true" />
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
                </ItemActions>
              </AccordionHeader>
              <AccordionContent className="pb-3">
                <OccasionPrefsEditor contactId={contact.id} occasion={o} channels={channels} />
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}
