import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import {
  BellOffIcon,
  CalendarDaysIcon,
  CakeIcon,
  ChevronDownIcon,
  HeartIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'
import { api, type Channel, type Contact, type Occasion } from '@/lib/api'
import { longDate, shortDate } from '@/lib/dates'
import { invalidateContactReminders } from '@/lib/prefs'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { OccasionForm } from '@/components/contacts/occasion-form'
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
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
 *  each wrapped in its own bordered card. The whole header is one toggle: the
 *  AccordionTrigger stretches under the entire row (c-frame-5 shape) and the
 *  row content floats above it as a pointer-events-none overlay, so every
 *  pixel toggles while Remind + an ⋮ menu (edit / delete, mirroring the
 *  summary card's menu) stay real buttons that never nest inside the trigger.
 *  Adding and editing happen in dialogs. */
export function OccasionsTab({ contact, channels }: { contact: Contact; channels: Channel[] }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editOcc, setEditOcc] = useState<Occasion | null>(null)
  const [delOcc, setDelOcc] = useState<Occasion | null>(null)
  // Controlled open rows: the chevron reads from it and it keeps the
  // full-header trigger honest.
  const [openItems, setOpenItems] = useState<string[]>([])
  // Countdown per occasion — shares the grid's ['upcoming','grid'] query, no
  // extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  // Contact-level master switch off → every per-occasion switch is locked.
  const paused = contact.prefs?.enabled === false
  const [pausedDialogOpen, setPausedDialogOpen] = useState(false)
  const activateAll = useMutation({
    mutationFn: () =>
      api(`/contacts/${contact.id}/prefs`, { method: 'PUT', body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => {
      invalidateContactReminders(qc, contact.id)
      toast.success('Notifications enabled')
    },
    onError: (e) => toast.error(`Failed to enable notifications: ${String(e)}`),
  })

  const deleteOcc = useMutation({
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
          <OccasionForm contactId={contact.id} onSaved={() => setAddOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  )

  const editDialog = (
    <Dialog open={editOcc !== null} onOpenChange={(open) => { if (!open) setEditOcc(null) }}>
      {editOcc && (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left capitalize">Edit {editOcc.type}</DialogTitle>
            <DialogDescription className="text-left">
              Type, recurrence, date, and label — saved in place. Reminder settings stay in the
              occasion's detail below its card.
            </DialogDescription>
          </DialogHeader>
          <OccasionForm contactId={contact.id} occasion={editOcc} onSaved={() => setEditOcc(null)} />
        </DialogContent>
      )}
    </Dialog>
  )

  const deleteDialog = (
    <AlertDialog open={delOcc !== null} onOpenChange={(open) => { if (!open) setDelOcc(null) }}>
      {delOcc && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
            <AlertDialogDescription>
              {delOcc.type} on {longDate(delOcc.base_date)} will be permanently deleted, together
              with its reminders and reminder settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteOcc.mutate(delOcc.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )

  const pausedDialog = (
    <AlertDialog open={pausedDialogOpen} onOpenChange={setPausedDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Notifications are paused</AlertDialogTitle>
          <AlertDialogDescription>
            Reminders for this contact are paused in Reminder Preferences. Turn notifications back on to
            unlock the switches below — nothing else changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => activateAll.mutate()}>Activate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return (
    // The tab's own card: titled header with the Add action (justify-between),
    // list body below.
    <Card className="gap-0 py-0">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
        <CardTitle className="text-sm font-semibold">Occasions</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add
        </Button>
      </div>
      <CardContent className="p-4">
        {paused && (
          <div className="text-muted-foreground mb-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <BellOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Notifications are paused for this contact — enable them in Reminder Preferences.</span>
          </div>
        )}
        {contact.occasions.length === 0 ? (
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
        ) : (
          <Accordion
            className="space-y-2"
            value={openItems}
            onValueChange={(v) => setOpenItems(v as string[])}
          >
            {contact.occasions.map((o) => (
              <OccasionCard
                key={o.id}
                contact={contact}
                occasion={o}
                up={upcomingByOccasion.get(o.id)}
                channels={channels}
                paused={paused}
                onPausedInteraction={() => setPausedDialogOpen(true)}
                open={openItems.includes(o.id)}
                onEdit={() => setEditOcc(o)}
                onDelete={() => setDelOcc(o)}
              />
            ))}
          </Accordion>
        )}
        {addDialog}
        {editDialog}
        {deleteDialog}
        {pausedDialog}
      </CardContent>
    </Card>
  )
}

/** One occasion card: header row + collapsible reminder detail.
 *
 *  Below sm the card relayouts for narrow screens: the date wraps instead of
 *  truncating (it is the important info), all badges (countdown, Custom,
 *  Paused) stack under the date, and a corner strip above the row carries the
 *  type avatar on the left with Remind + the ⋮ menu on the right — the same
 *  treatment as the contact card's mobile header. */
function OccasionCard({
  contact,
  occasion: o,
  up,
  channels,
  paused,
  onPausedInteraction,
  open,
  onEdit,
  onDelete,
}: {
  contact: Contact
  occasion: Occasion
  /** Next occurrence of this occasion — undefined when none is upcoming. */
  up?: { date: string; days_until: number }
  channels: Channel[]
  paused: boolean
  onPausedInteraction: () => void
  open: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const TypeIcon = TYPE_ICONS[o.type] ?? CalendarDaysIcon
  const countdown = up ? (up.days_until <= 0 ? 'today' : `in ${up.days_until}d`) : null

  /** Edit / Delete menu — rendered inline in the row (desktop) and as the
   *  card's top-right corner action (mobile). */
  const actionsMenu = (triggerClass: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`More actions for ${o.type}`}
            className={triggerClass}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        }
      />
      {/* min-w-40 + plain labels mirror the summary card's actions menu. */}
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    // One bordered card per occasion: header row + editor share the same
    // container. (border + last:border-b beat the primitive's
    // border-b/last:border-b-0 divider styling.)
    <AccordionItem value={o.id} className="rounded-lg border bg-card last:border-b">
      {/* Mobile: type avatar on the left, Remind + ⋮ menu on the right —
          the corner action strip mirrors the contact card's mobile header. */}
      <div className="flex items-center justify-between gap-2 px-3 pt-3 sm:hidden">
        <Avatar size="default" className="shrink-0">
          <AvatarFallback>
            <TypeIcon aria-hidden="true" className="size-4" />
          </AvatarFallback>
        </Avatar>
        <span className="flex items-center gap-1">
          {up && (
            <ReminderTrigger
              kind="occasion"
              occasionId={o.id}
              contactId={contact.id}
              date={up.date}
              title={`${contact.name}'s ${o.type}`}
              variant="ghost"
              compact
              className="sm:hidden size-7 justify-center px-0 text-muted-foreground hover:text-foreground"
            />
          )}
          {actionsMenu('sm:hidden')}
        </span>
      </div>
      <AccordionHeader className="relative w-full rounded-lg">
        {/* Full-coverage toggle: an invisible button stretched across the
            whole header — every pixel of the card top toggles. The primitive's
            own chevron is replaced by the overlay's, so nothing paints under
            the actions. While open the highlight loses its bottom rounding so
            it meets the detail's divider flush. */}
        <AccordionTrigger
          className={cn('absolute inset-0 cursor-pointer [&>svg]:hidden', open && 'rounded-b-none')}
          aria-label={`Toggle ${o.type} details`}
        />
        <div className="pointer-events-none relative z-10 flex w-full items-center gap-3 py-3 px-3">
          {/* Circular chip, same avatar idiom as the agenda rows — hidden on
              mobile, the row needs the width for the date. */}
          <Avatar size="lg" className="max-sm:hidden shrink-0">
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
            {/* Mobile lets the date wrap — it is the info that must survive
                narrow screens, truncation hides it. */}
            <ItemDescription className="truncate max-sm:whitespace-normal">
              {shortDate(o.base_date)} · {RECURRENCE_COPY[o.recurrence]}
            </ItemDescription>
            {/* Mobile-only: all badges stack under the date, out of the
                cramped right edge. mt-2 separates them from the date line. */}
            <span className="mt-2 flex items-center gap-1 sm:hidden">
              {o.prefs?.custom === true && <Badge variant="outline">Custom</Badge>}
              {o.prefs?.enabled === false && <Badge variant="warning-outline">Paused</Badge>}
              {countdown && up && (
                <Badge variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}>
                  {countdown}
                </Badge>
              )}
            </span>
          </ItemContent>
          <span className="flex shrink-0 items-center gap-1 max-sm:hidden">
            {o.prefs?.custom === true && <Badge variant="outline">Custom</Badge>}
            {o.prefs?.enabled === false && <Badge variant="warning-outline">Paused</Badge>}
            {countdown && up && (
              <Badge variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}>
                {countdown}
              </Badge>
            )}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
          <ItemActions className="pointer-events-auto">
            {/* Remind needs an actual occurrence date: the backend matches
                `date` exactly, and a base date is not an occurrence for otonan
                (base+210n). Below sm it sits in the card's corner strip
                instead, next to the ⋮ menu. */}
            {up && (
              <ReminderTrigger
                kind="occasion"
                occasionId={o.id}
                contactId={contact.id}
                date={up.date}
                title={`${contact.name}'s ${o.type}`}
                variant="ghost"
                compact
                className="max-sm:hidden size-7 justify-center px-0 text-muted-foreground hover:text-foreground"
              />
            )}
            {/* Desktop inline menu — on mobile the menu lives in the card's
                top-right corner row instead. */}
            {actionsMenu('max-sm:hidden')}
          </ItemActions>
        </div>
      </AccordionHeader>
      <AccordionContent>
        <div className="border-t px-4 pb-4 pt-3">
          <OccasionPrefsEditor
            contactId={contact.id}
            occasion={o}
            channels={channels}
            paused={paused}
            onPausedInteraction={onPausedInteraction}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
