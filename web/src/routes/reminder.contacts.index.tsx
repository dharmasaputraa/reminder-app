import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'motion/react'
import { api, type Contact } from '../lib/api'
import { validateContactsSearch, type ContactsSearch } from '../lib/contacts-search'
import { pageTitle } from '../lib/page-title'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'
import { ContactsGrid, useNextReminderMap } from '@/components/contacts/contacts-grid'
import { useIsLg } from '@/hooks/use-lg'
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
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/reminder/contacts/')({
  validateSearch: validateContactsSearch,
  component: Contacts,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

function Contacts() {
  const { c } = Route.useSearch()
  const nav = Route.useNavigate()
  const qc = useQueryClient()
  const isLg = useIsLg()

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api<{ contacts: Contact[] }>('/contacts') })
  const next = useNextReminderMap()

  const selectedId = typeof c === 'number' ? c : undefined

  /** Spec history contract: docked selection REPLACES (browsing rows leaves
   *  one history entry); below lg a row is ordinary navigation to the page. */
  const select = (id: number) => {
    if (!isLg) {
      nav({ to: '/reminder/contacts/$id', params: { id: String(id) } })
      return
    }
    nav({ search: (prev: ContactsSearch) => ({ ...prev, c: id }), replace: true })
  }

  const openCreate = () => {
    if (!isLg) {
      nav({ to: '/reminder/contacts/new' })
      return
    }
    nav({ search: () => ({ c: 'new' }), replace: true })
  }

  // Row-action delete: the confirm dialog and DELETE mutation live here so
  // deleting the selected contact can drop ?c in the same update (spec).
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null)
  const del = useMutation({
    mutationFn: (contact: Contact) => api(`/contacts/${contact.id}`, { method: 'DELETE' }),
    onSuccess: (_res, contact) => {
      toast.success('Contact deleted')
      setPendingDelete(null)
      if (selectedId === contact.id) nav({ search: () => ({}), replace: true })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  const showPanel = isLg && c !== undefined

  // The aside stays mounted so the close tween runs on a fully-rendered panel;
  // keep the last opened value rendered while `?c` is gone, so the collapsing
  // panel doesn't blank out mid-animation.
  const [lastC, setLastC] = useState<number | 'new' | null>(null)
  if (c !== undefined && c !== lastC) setLastC(c)
  const panelC = c ?? lastC

  return (
    <div className="space-y-4">
      {/* Page header — the dashboard's pattern: title left, primary action
          right. Every reminder page leads with this row. */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Contacts</h1>
        <Button size="sm" onClick={openCreate}>
          Add contact
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
        <div className="min-w-0 flex-1">
          {contacts.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-[420px] w-full rounded-xl" />
            </div>
          ) : contacts.isError ? (
            <p className="text-red-600">{String(contacts.error)}</p>
          ) : (
            <ContactsGrid
              contacts={contacts.data?.contacts ?? []}
              nextById={next.map}
              selectedId={selectedId}
              isLoading={next.isLoading}
              onSelect={select}
              onRequestDelete={setPendingDelete}
            />
          )}
        </div>

        {/* Docked right section (lg+ only): the dashboard agenda panel's exact
            collapse — width + opacity tween in place, fixed-width inner so the
            panel never squishes mid-transition, and the lg gap living on the
            animated marginLeft so a closed panel leaves no dead space. When ?c
            is absent the grid takes the full width. */}
        <motion.aside
          aria-label="Contact detail"
          inert={!showPanel}
          initial={false}
          animate={{
            width: showPanel ? 'auto' : 0,
            opacity: showPanel ? 1 : 0,
            marginLeft: showPanel ? 16 : 0,
          }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="hidden h-[560px] shrink-0 overflow-hidden rounded-xl border bg-card lg:block"
        >
          <div className="h-full w-[280px] xl:w-[340px]">
            {panelC !== null && (
              <motion.div
                key={String(panelC)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="h-full overflow-y-auto"
              >
                <ContactDetailContent contactId={panelC} variant="docked" />
              </motion.div>
            )}
          </div>
        </motion.aside>
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All occasions and reminder preferences for this contact will be deleted too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && del.mutate(pendingDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
