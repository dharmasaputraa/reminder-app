import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { ContactEditForm } from '@/components/contacts/contact-edit-form'

export const Route = createFileRoute('/reminder/contacts/new')({
  component: () => <ContactEditForm contactId="new" variant="page" />,
  head: () => ({ meta: [{ title: pageTitle('New contact') }] }),
})
