import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { api, type Channel, type Settings } from '@/lib/api'
import { ChannelIcon } from '@/lib/channel-icons'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

/** The channel list with its row actions. Owns the channels + settings
 *  queries and the row mutations; the add surface is AddChannelDialog,
 *  hosted by the route (`onAdd` opens it from the empty state). */
export function ChannelList({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })

  // Toggling a channel's "Default" saves immediately — same inline-edit model
  // as the card's active switch. The default channels receive the reminders of
  // contacts without their own selection.
  const setDefault = useMutation({
    mutationFn: (ids: string[]) =>
      api('/settings', { method: 'PUT', body: JSON.stringify({ ...settings.data, default_channel_ids: ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => toast.error(`Failed to save default channel: ${String(e)}`),
  })
  const isDefault = (id: string) => (settings.data?.default_channel_ids ?? []).includes(id)
  const toggleDefault = (id: string, on: boolean) => {
    const cur = new Set(settings.data?.default_channel_ids ?? [])
    if (on) cur.add(id)
    else cur.delete(id)
    setDefault.mutate([...cur])
  }
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      api(`/channels/${v.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v.enabled }) }),
    onSuccess: invalidate,
  })
  const del = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
  const test = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/test`, { method: 'POST' }),
    onSuccess: () => toast.success('Test succeeded — notification sent.'),
    onError: (e) => toast.error(`Test failed: ${String(e)}`),
  })

  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-[70px] w-full rounded-xl" />
        <Skeleton className="h-[70px] w-full rounded-xl" />
        <Skeleton className="h-[70px] w-full rounded-xl" />
      </div>
    )
  if (q.isError) return <p className="text-red-600">{String(q.error)}</p>

  const channels = q.data?.channels ?? []
  if (channels.length === 0)
    return (
      <Empty className="rounded-xl border py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChannelIcon type="gotify" className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No channels yet</EmptyTitle>
          <EmptyDescription>
            Add a Gotify, Telegram, or email channel so reminders actually get delivered.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onAdd}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            Add channel
          </Button>
        </EmptyContent>
      </Empty>
    )

  return (
    <div className="space-y-3">
      {channels.map((ch) => (
        <Card key={ch.id} className="flex flex-row items-center gap-3 p-3">
          <Badge variant={ch.enabled ? 'default' : 'secondary'}>{ch.type}</Badge>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <ChannelIcon type={ch.type} className="size-4" />
              <p className="truncate font-medium">{ch.name}</p>
            </div>
            <p className="text-xs text-muted-foreground">{ch.enabled ? 'active' : 'inactive'}</p>
          </div>
          {/* A span, not a label: a wrapping <label> forwards a second, opposite
              click to the Checkbox's hidden input. The Checkbox carries its own
              aria-label instead. */}
          <span className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={isDefault(ch.id)}
              disabled={!settings.data || setDefault.isPending}
              onCheckedChange={(v) => toggleDefault(ch.id, v === true)}
              aria-label="Set as default channel"
            />
            Default
          </span>
          {/* Same: the Switch must not be wrapped in a label. */}
          <span className="flex items-center gap-1.5 text-sm">
            <Switch
              checked={ch.enabled}
              onCheckedChange={(v) => toggle.mutate({ id: ch.id, enabled: v === true })}
              aria-label="Toggle channel active"
            />
            active
          </span>
          <Button variant="outline" size="sm" onClick={() => test.mutate(ch.id)} disabled={test.isPending}>
            Test
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm">Delete</Button>}
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete channel {ch.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This channel can no longer be used to send reminders.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => del.mutate(ch.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      ))}
    </div>
  )
}
