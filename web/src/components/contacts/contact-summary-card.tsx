import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { ApiError, api, type Contact } from '@/lib/api'
import { initials } from '@/lib/initials'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'

interface ContactSummaryCardProps {
  contactId: number
  /** Renders the Edit action; the host opens the edit overlay (lg) or the
   *  edit dialog (below lg) — identity-only editing. */
  onEdit?: () => void
}

/** The right-hand sticky summary card of the detail page: the actions row
 *  (Edit + ⋮ holding the destructive delete) above the read-only identity
 *  block (avatar, name, nickname, notes). Content only — the host supplies
 *  the card chrome so the edit overlay can slide within one visual card.
 *  Shares the ['contact', id] query key with the sections column
 *  (ContactDetailContent); react-query serves both from one fetch. */
export function ContactSummaryCard({ contactId, onEdit }: ContactSummaryCardProps) {
  const id = String(contactId)
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
  })
  // Delete lives behind the ⋮ menu: the item opens this confirm dialog.
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
    )
  if (contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    // Compact on purpose: the sections column renders the full error state
    // with the Back button; this card never duplicates it.
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">
          {notFound ? 'Contact not found' : 'Failed to load contact'}
        </p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
      </div>
    )
  }
  const c = contact.data!

  return (
    <>
      {/* In-flow actions row: takes layout space, so it can never paint over
          the avatar below. Edit lives in the menu so the row stays a single
          compact control. */}
      <div className="flex items-center justify-end px-4 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="icon-sm" aria-label="More actions">
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            }
          />
          {/* min-w-40: the menu tracks its 28px icon anchor by default,
              which wraps the item labels onto two lines. */}
          <DropdownMenuContent align="end" className="min-w-40">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon aria-hidden="true" />
                Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Identity block: avatar above the name (+ nickname) — centered like
          a profile header, generous air above the avatar. Read-only:
          editing lives in the overlay (lg) / dialog (below lg). */}
      <div className="flex flex-col items-center gap-2 px-4 pt-8 pb-5 text-center">
        <Avatar className="size-24">
          <AvatarFallback className="text-2xl">{initials(c.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-1">
          <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
          {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
        </div>
        {/* Notes section — box height matches the edit form's Notes
            textarea (min-h-16, same padding/border/text sizing) so the
            read-only and editing surfaces read as the same field. */}
        <div className="w-full space-y-1.5 pt-4 text-left">
          <p className="text-muted-foreground text-xs font-medium">Notes</p>
          <div className="flex min-h-16 items-start rounded-lg border bg-muted/30 px-3 py-2">
            {c.notes ? (
              <p className="text-pretty whitespace-pre-wrap">{c.notes}</p>
            ) : (
              <p className="text-muted-foreground">No notes yet.</p>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
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
    </>
  )
}
