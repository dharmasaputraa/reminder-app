import { createFileRoute, redirect } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'

export const Route = createFileRoute('/reminder/contacts/$id')({
  beforeLoad: ({ params }) => {
    // /new has its own static route; anything else non-numeric is a bad URL.
    if (!/^\d+$/.test(params.id)) throw redirect({ to: '/reminder/contacts' })
  },
  component: ContactDetailPage,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

function ContactDetailPage() {
  const { id } = Route.useParams()
  return <ContactDetailContent contactId={Number(id)} variant="page" />
}
