import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CalendarDaysIcon, SlidersHorizontalIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { OccasionsTab } from '@/components/contacts/occasions-tab'
import { ReminderPrefsTab } from '@/components/contacts/reminder-prefs-tab'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** The /reminder/contacts/$id sections column: one Card, two tabs. Owns the
 *  contact/channels/settings queries (shared cache with the summary card and
 *  the docked panel) and the loading/error states; the tabs own their
 *  mutations. Both panels stay mounted (keepMounted) so a half-typed form
 *  survives switching tabs. */
export function ContactDetailPageContent({ contactId }: { contactId: string }) {
  const nav = useNavigate()
  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => api<Contact>(`/contacts/${contactId}`),
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  if (contact.isLoading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex h-11 items-center px-3">
            <Skeleton className="h-8 w-64" />
          </div>
        </div>
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex h-11 items-center border-b px-4">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="space-y-2.5 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    )
  }
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
  const channelList = channels.data?.channels ?? []

  return (
    // The tabs live on their own card; each tab renders its own titled card
    // below (Occasions / Reminder Preferences).
    <Tabs defaultValue="occasions" className="flex flex-col gap-4">
      <Card className="gap-0 py-0">
        <div className="flex h-11 items-center px-3">
          <TabsList>
            <TabsTrigger value="occasions">
              <CalendarDaysIcon data-icon="inline-start" aria-hidden="true" />
              Occasions ({c.occasions.length})
            </TabsTrigger>
            <TabsTrigger value="prefs">
              <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
              Reminder Preferences
            </TabsTrigger>
          </TabsList>
        </div>
      </Card>
      <TabsContent value="occasions" keepMounted>
        <OccasionsTab contact={c} channels={channelList} />
      </TabsContent>
      <TabsContent value="prefs" keepMounted>
        <ReminderPrefsTab contact={c} channels={channelList} settings={settings.data} />
      </TabsContent>
    </Tabs>
  )
}
