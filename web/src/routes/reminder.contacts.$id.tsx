import { createFileRoute, redirect } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { pageTitle } from '../lib/page-title'
import { validateContactDetailSearch } from '../lib/contacts-search'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'
import { ContactEditForm } from '@/components/contacts/contact-edit-form'
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

/** Read-only detail column + docked edit side section (lg) — the same
 *  two-section pattern as the dashboard and the contacts index. Below lg
 *  the side section becomes a dialog (the EventDetailDialog contract).
 *  Edit state is URL-owned: open pushes ?edit (Back closes), close
 *  replace-drops it. */
function ContactDetailPage() {
  const { id } = Route.useParams()
  const { edit } = Route.useSearch()
  const nav = Route.useNavigate()
  const isLg = useIsLg()
  const editOpen = edit === true

  /** Open edit: push, so browser Back closes the panel/dialog. */
  const openEdit = () => nav({ search: () => ({ edit: true }) })
  /** Close edit: replace-drop the param (no-op when nothing is open) so no
   *  stale history entry reopens it later. */
  const closeEdit = () => {
    if (!editOpen) return
    nav({ search: () => ({}), replace: true })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-0">
      {/* Detail column: always full width — no max-width animation
          (revision spec); the edit aside pushes it through flex alone. */}
      <div className="min-w-0 flex-1">
        <ContactDetailContent contactId={Number(id)} variant="page" onEdit={openEdit} />
      </div>

      {/* Edit side section (lg+ only): the contacts-index collapse tween
          verbatim — width + opacity + marginLeft in place, fixed-width inner
          so the panel never squishes mid-transition, lg gap on the animated
          marginLeft. The form stays mounted through the close tween (inert),
          so unsaved edits survive an accidental close. Panel height is
          content-driven (no fixed height) since the form is identity-only
          and short — the panel hugs its content. Gated on isLg (not just
          hidden) so the below-lg dialog never coexists with a second
          mounted form carrying the same DOM ids. */}
      {isLg && (
        <motion.aside
          aria-label="Edit contact"
          inert={!editOpen}
          initial={false}
          animate={{
            width: editOpen ? 'auto' : 0,
            opacity: editOpen ? 1 : 0,
            marginLeft: editOpen ? 16 : 0,
          }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="hidden shrink-0 overflow-hidden rounded-xl border bg-card lg:block"
        >
          <div className="w-[360px] xl:w-[420px]">
            <ContactEditForm
              contactId={Number(id)}
              variant="panel"
              onClose={closeEdit}
              onSaved={closeEdit}
            />
          </div>
        </motion.aside>
      )}

      {/* Below lg the side section doesn't exist — the dialog replaces it.
          The same ?edit param drives both surfaces. */}
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
