import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { ChevronRightIcon, Maximize2Icon, PencilIcon, XIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { DetailRow, PanelSection } from '@/components/panel-section'
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
import { Skeleton } from '@/components/ui/skeleton'

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (page occasion rows). */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

/** Compact variant for the narrow docked panel: "Wed, 18 Jun 2003". */
function shortDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEE, d MMM yyyy')
}

interface ContactDetailContentProps {
  contactId: number
  /** docked = read-only right section of /reminder/contacts;
   *  page = read-only detail column of /reminder/contacts/$id. */
  variant: 'docked' | 'page'
  /** page only: renders the Edit action; the host opens the edit side
   *  section (lg) or edit dialog (below lg). Editing itself lives in
   *  ContactEditForm — this component is read-only by design. */
  onEdit?: () => void
}

export function ContactDetailContent({ contactId, variant, onEdit }: ContactDetailContentProps) {
  const id = String(contactId)
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  // Countdown per occasion (next occurrence inside the 400-day window) —
  // shares the grid's ['upcoming','grid'] query, no extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  const delContact = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Contact deleted')
      // The grid (and next-reminder column) must drop the deleted contact.
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      nav({ to: '/reminder/contacts', replace: true })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  if (contact.isLoading)
    return (
      <div>
        <div className="flex flex-col items-center gap-2 px-4 pt-8">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-6 space-y-2.5 border-t px-4 py-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  if (contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">{notFound ? 'Contact not found' : 'Failed to load contact'}</p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
        <Button variant="outline" size="sm" onClick={() => nav({ to: '/reminder/contacts' })}>
          Back to contacts
        </Button>
      </div>
    )
  }
  const c = contact.data!

  /** Identity block: avatar above the name (+ nickname) — the subject,
   *  centered like a profile header in both variants. */
  const identityBlock = (
    <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
      <Avatar className="size-16">
        <AvatarFallback className="text-lg">{initials(c.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
        {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
      </div>
    </div>
  )

  const notesSection = c.notes ? (
    <PanelSection title="Notes">
      <p className="text-pretty whitespace-pre-wrap">{c.notes}</p>
    </PanelSection>
  ) : null

  const remindersSection = (
    <PanelSection title="Reminders">
      <DetailRow label="Status">
        {c.prefs?.enabled === false ? (
          <Badge variant="warning-outline">Paused</Badge>
        ) : (
          <Badge variant="success-outline">Active</Badge>
        )}
      </DetailRow>
      <DetailRow label="Offsets">
        {c.prefs?.offsets?.length ? (
          <span className="flex flex-wrap justify-end gap-1">
            {[...c.prefs.offsets].sort((a, b) => b - a).map((n, i) => (
              <Badge key={`${n}-${i}`} variant="secondary">D-{n}</Badge>
            ))}
          </span>
        ) : (
          <>
            Default
            {settings.data && (
              <span className="text-muted-foreground font-normal">
                {' '}({settings.data.default_offsets.map((n) => `D-${n}`).join(', ')})
              </span>
            )}
          </>
        )}
      </DetailRow>
      <DetailRow label="Channels">
        {(() => {
          const chosen = (channels.data?.channels ?? []).filter((ch) => c.prefs?.channel_ids.includes(ch.id))
          if (chosen.length === 0) {
            // No own selection → the system default channels apply.
            const defaults = (channels.data?.channels ?? []).filter((ch) =>
              (settings.data?.default_channel_ids ?? []).includes(ch.id))
            return (
              <>
                Default
                <span className="text-muted-foreground font-normal">
                  {' '}({defaults.map((d) => d.name).join(', ') || 'all channels'})
                </span>
              </>
            )
          }
          return (
            <span className="flex flex-wrap justify-end gap-1">
              {chosen.map((ch) => (
                <Badge key={ch.id} variant="secondary">{ch.name} ({ch.type})</Badge>
              ))}
            </span>
          )
        })()}
      </DetailRow>
    </PanelSection>
  )

  // ============ DOCKED: agenda-panel anatomy — h-11 title bar with the
  // fullscreen + close actions, then read-only sections separated by
  // hairlines. Occasions cap at 3 with a see-all jump to the page. ============
  if (variant === 'docked') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">Contact</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open fullscreen detail"
              // Rendered as a real link: cmd/ctrl+click, middle-click and
              // the context menu open the fullscreen page in a new tab
              // natively (30e6655); a plain click is the Link's SPA nav.
              render={<Link to="/reminder/contacts/$id" params={{ id }} />}
            >
              <Maximize2Icon aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close panel"
              onClick={() => nav({ to: '/reminder/contacts', search: {}, replace: true })}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {identityBlock}
          {notesSection}
          <PanelSection title="Occasions">
            {c.occasions.length === 0 ? (
              <p className="text-muted-foreground">
                No occasions yet — open the fullscreen detail to add one.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {c.occasions.slice(0, 3).map((o) => {
                    const up = upcomingByOccasion.get(o.id)
                    return (
                      <div key={o.id} className="rounded-lg bg-muted/60 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-muted-foreground text-xs font-medium capitalize">
                              {o.type}
                            </p>
                            <p className="mt-0.5 text-sm font-medium tabular-nums">{shortDate(o.base_date)}</p>
                          </div>
                          {up && (
                            <Badge
                              variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                              className="shrink-0"
                            >
                              {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {c.occasions.length > 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mx-auto flex"
                    onClick={() => nav({ to: '/reminder/contacts/$id', params: { id } })}
                  >
                    See all {c.occasions.length} occasions
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </PanelSection>
          {remindersSection}
        </div>
      </div>
    )
  }

  // ============ PAGE: read-only detail card — the panel anatomy at page
  // width (hairline sections, no nested cards). Edit/Delete pinned to the
  // top-right corner over the centered identity. ============
  return (
    <div className="relative rounded-xl border bg-card text-sm">
      <div className="absolute end-4 top-4 flex items-center gap-1.5">
        {onEdit && (
          <Button size="sm" onClick={onEdit}>
            <PencilIcon aria-hidden="true" />
            Edit
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm">Delete contact</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                All occasions and reminder preferences for this contact will be deleted too.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => delContact.mutate()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {identityBlock}
      {notesSection}
      <PanelSection title="Occasions">
        {c.occasions.length === 0 ? (
          <p className="text-muted-foreground">
            No occasions yet — use Edit to add the first one.
          </p>
        ) : (
          <div className="divide-y">
            {c.occasions.map((o) => {
              const up = upcomingByOccasion.get(o.id)
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                    <span className="truncate">{longDate(o.base_date)}</span>
                  </span>
                  {up && (
                    <Badge
                      variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                      className="shrink-0"
                    >
                      {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                    </Badge>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </PanelSection>
      {remindersSection}
    </div>
  )
}
