import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { ContactDetailContent } from '@/components/contacts/contact-detail-content'

export const Route = createFileRoute('/reminder/contacts/new')({
  component: () => <ContactDetailContent contactId="new" variant="page" />,
  head: () => ({ meta: [{ title: pageTitle('New contact') }] }),
})
