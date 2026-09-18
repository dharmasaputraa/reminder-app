import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { pageTitle } from '../lib/page-title'
import { AddChannelDialog } from '@/components/channels/add-channel-dialog'
import { ChannelList } from '@/components/channels/channel-list'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/reminder/channels')({
  component: Channels,
  head: () => ({ meta: [{ title: pageTitle('Channels') }] }),
})

function Channels() {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-4">
      {/* Page header — the dashboard's pattern: title left, primary action
          right. Every reminder page leads with this row. */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Notification Channels</h1>
          <p className="text-sm text-muted-foreground">
            Contacts without their own channel selection use the default ones. No default — every
            enabled channel is used.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setAddOpen(true)}>
          Add channel
        </Button>
      </div>

      <ChannelList onAdd={() => setAddOpen(true)} />
      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
