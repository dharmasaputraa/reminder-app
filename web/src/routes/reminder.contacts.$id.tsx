import { createFileRoute, redirect } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { pageTitle } from '../lib/page-title'
import { validateContactDetailSearch } from '../lib/contacts-search'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'
import { ContactEditForm } from '@/components/contacts/contact-edit-form'
import { ContactSummaryCard } from '@/components/contacts/contact-summary-card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIsLg } from '@/hooks/use-lg'

export const Route = createFileRoute('/reminder/contacts/$id')({
  beforeLoad: ({ params }) => {
    // /new has its own static route; anything else non-numeric is a bad URL.
    if (!/^\d+$/.test(params.id)) throw redirect({ to: '/reminder/contacts' })
  },
  validateSearch: validateContactDetailSearch,
  component: ContactDetailPage,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

/** Editable sections column + sticky right identity card with the edit
 *  overlay docked inside it (lg) — the agenda-panel detail-layer pattern:
 *  the overlay sweeps in from the column's right edge covering the card,
 *  and the sections column stays visible and interactive. Below lg the
 *  card stacks on top (flex order) and the dialog replaces the overlay.
 *  Edit state is URL-owned: open pushes ?edit (Back closes), close
 *  replace-drops it. The form stays mounted through close (inert), so
 *  unsaved edits survive an accidental close. */
function ContactDetailPage() {
  const { id } = Route.useParams()
  const { edit } = Route.useSearch()
  const nav = Route.useNavigate()
  const isLg = useIsLg()
  const editOpen = edit === true

  /** Open edit: push, so browser Back closes the overlay/dialog. */
  const openEdit = () => nav({ search: () => ({ edit: true }) })
  /** Close edit: replace-drop the param (no-op when nothing is open) so no
   *  stale history entry reopens it later. */
  const closeEdit = () => {
    if (!editOpen) return
    nav({ search: () => ({}), replace: true })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Sections column: occasions + preferences — the long content the
          identity card sticks alongside. Order flips it below the card on
          mobile and back to the left at lg. */}
      <div className="order-2 min-w-0 flex-1 lg:order-1">
        <ContactDetailContent contactId={Number(id)} variant="page" />
      </div>

      {/* Sticky identity column: the summary card is the base layer of one
          visual card; the edit overlay is absolute inset-0 within it. The
          base layer goes inert while covered so Tab can't land on the
          hidden Edit/⋮ buttons (the agenda panel's pattern). The min-h
          floor is the measured max of the card's (361px) and the edit
          form's (359px) natural heights, held in BOTH states so switching
          edit on/off never resizes the card and the form has no dead space
          below Notes. Longer notes grow both naturally. The overlay is
          lg-only; below lg the dialog replaces it (same ?edit param). */}
      <div className="order-1 shrink-0 lg:order-2 lg:sticky lg:top-0 lg:w-[300px] xl:w-[340px]">
        <div className="relative overflow-hidden rounded-xl border bg-card lg:min-h-[361px]">
          <div inert={editOpen}>
            <ContactSummaryCard contactId={Number(id)} onEdit={openEdit} />
          </div>
          {isLg && (
            <motion.div
              aria-label="Edit contact"
              inert={!editOpen}
              initial={false}
              animate={{ x: editOpen ? 0 : '100%' }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 z-20 flex flex-col bg-card"
            >
              <ContactEditForm
                contactId={Number(id)}
                variant="panel"
                onClose={closeEdit}
                onSaved={closeEdit}
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* Below lg the overlay doesn't exist — the dialog replaces it. The
          same ?edit param drives both surfaces. */}
      {!isLg && (
        <Dialog open={editOpen} onOpenChange={(open) => { if (!open) closeEdit() }}>
          {editOpen && (
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-left">Edit contact</DialogTitle>
                <DialogDescription className="text-left">
                  Name, nickname, and notes — saved in place.
                </DialogDescription>
              </DialogHeader>
              <ContactEditForm contactId={Number(id)} variant="dialog" onSaved={closeEdit} />
            </DialogContent>
          )}
        </Dialog>
      )}
    </div>
  )
}
