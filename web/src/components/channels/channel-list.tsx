import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { ChevronDownIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import { api, type Channel, type Settings } from '@/lib/api'
import { ChannelIcon } from '@/lib/channel-icons'
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

/** The channels list, in the OccasionsTab shape: accordion items per channel
 *  (collapsed by default; expanding reveals the channel's controls), delete
 *  in a confirm dialog owned here. Owns the channels + settings queries and
 *  all row mutations. The backend exposes no channel editing beyond `enabled`
 *  (config is encrypted write-only), so the ⋮ menu is Delete only. The Add
 *  action lives in the page header and the empty state (`onAdd`); the add
 *  dialog is hosted by the route. */
export function ChannelList({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null)
  // Controlled open rows: the chevron reads from it and it keeps the
  // full-header trigger honest.
  const [openItems, setOpenItems] = useState<string[]>([])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })

  // Toggling a channel's "Default" saves immediately — same inline-edit model
  // as the active switch. The default channels receive the reminders of
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
    onError: (e) => toast.error(`Failed to update channel: ${String(e)}`),
  })
  const del = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate()
    },
    onError: (e) => toast.error(`Failed to delete channel: ${String(e)}`),
  })
  const test = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/test`, { method: 'POST' }),
    onSuccess: () => toast.success('Test succeeded — notification sent.'),
    onError: (e) => toast.error(`Test failed: ${String(e)}`),
  })

  const channels = q.data?.channels ?? []

  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-[68px] w-full rounded-lg" />
            <Skeleton className="h-[68px] w-full rounded-lg" />
            <Skeleton className="h-[68px] w-full rounded-lg" />
          </div>
        ) : q.isError && !q.data ? (
          <p className="text-red-600">{String(q.error)}</p>
        ) : channels.length === 0 ? (
          <Empty className="py-10">
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
        ) : (
          <Accordion
            className="space-y-2"
            value={openItems}
            onValueChange={(v) => setOpenItems(v as string[])}
          >
            {channels.map((ch) => (
              <ChannelItem
                key={ch.id}
                channel={ch}
                defaultOn={isDefault(ch.id)}
                defaultPending={!settings.data || setDefault.isPending}
                open={openItems.includes(ch.id)}
                testPending={test.isPending}
                onToggleDefault={(on) => toggleDefault(ch.id, on)}
                onToggleActive={(on) => toggle.mutate({ id: ch.id, enabled: on })}
                onTest={() => test.mutate(ch.id)}
                onDelete={() => setDeleteTarget(ch)}
              />
            ))}
          </Accordion>
        )}
      </CardContent>
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete channel {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This channel can no longer be used to send reminders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && del.mutate(deleteTarget.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/** One channel item: identity row + collapsible controls, the OccasionCard
 *  mechanic — the AccordionTrigger stretches under the entire header row and
 *  the row content floats above it as a pointer-events-none overlay, so every
 *  pixel toggles while the ⋮ menu stays a real button outside the trigger. */
function ChannelItem({
  channel: ch,
  defaultOn,
  defaultPending,
  open,
  testPending,
  onToggleDefault,
  onToggleActive,
  onTest,
  onDelete,
}: {
  channel: Channel
  defaultOn: boolean
  defaultPending: boolean
  open: boolean
  testPending: boolean
  onToggleDefault: (on: boolean) => void
  onToggleActive: (on: boolean) => void
  onTest: () => void
  onDelete: () => void
}) {
  /** Delete menu — rendered inline in the row. (No Edit: the backend accepts
   *  only `enabled` patches; config is write-only encrypted.) */
  const actionsMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`More actions for ${ch.name}`}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        }
      />
      {/* min-w-40 + plain labels mirror the occasion row's actions menu. */}
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    // One bordered card per channel: header row + controls share the same
    // container. (border + last:border-b beat the primitive's
    // border-b/last:border-b-0 divider styling.)
    <AccordionItem value={ch.id} className="rounded-lg border bg-card last:border-b">
      <AccordionHeader className="relative w-full rounded-lg">
        {/* Full-coverage toggle: an invisible button stretched across the
            whole header — every pixel of the card top toggles. The primitive's
            own chevron is replaced by the overlay's, so nothing paints under
            the actions. While open the highlight loses its bottom rounding so
            it meets the detail's divider flush. */}
        <AccordionTrigger
          className={cn('absolute inset-0 cursor-pointer [&>svg]:hidden', open && 'rounded-b-none')}
          aria-label={`Toggle ${ch.name} details`}
        />
        <div className="pointer-events-none relative z-10 flex w-full items-center gap-3 py-3 px-3">
          {/* Circular brand chip, the occasion row's avatar idiom. */}
          <Avatar size="lg" className="shrink-0">
            <AvatarFallback>
              <ChannelIcon type={ch.type} className="size-5" />
            </AvatarFallback>
          </Avatar>
          <ItemContent>
            <ItemTitle>
              <span className="min-w-0 truncate">{ch.name}</span>
            </ItemTitle>
            <ItemDescription className="truncate">{ch.type}</ItemDescription>
          </ItemContent>
          <span className="flex shrink-0 items-center gap-1">
            {defaultOn && <Badge variant="outline">Default</Badge>}
            {!ch.enabled && <Badge variant="warning-outline">Inactive</Badge>}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
          <ItemActions className="pointer-events-auto">
            {/* Test sits on the row (the occasion row's Remind slot), left of
                the ⋮ menu — both real buttons outside the trigger overlay. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onTest}
              disabled={testPending}
              aria-label={`Test ${ch.name}`}
            >
              Test
            </Button>
            {actionsMenu()}
          </ItemActions>
        </div>
      </AccordionHeader>
      <AccordionContent>
        <div className="border-t px-4 pb-4 pt-3">
          <div className="space-y-3">
            {/* Both controls are checkbox/switch rows — a wrapping <label>
                would forward a second, opposite click to the control's hidden
                input (de7011d), so the labels sit beside, never around. */}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`ch-default-${ch.id}`}>Default</FieldLabel>
                <FieldDescription>
                  Receives reminders for contacts without their own channel selection.
                </FieldDescription>
              </FieldContent>
              <Checkbox
                id={`ch-default-${ch.id}`}
                checked={defaultOn}
                disabled={defaultPending}
                onCheckedChange={(v) => onToggleDefault(v === true)}
                aria-label="Set as default channel"
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`ch-active-${ch.id}`}>Active</FieldLabel>
                <FieldDescription>Inactive channels are skipped when sending.</FieldDescription>
              </FieldContent>
              <Switch
                id={`ch-active-${ch.id}`}
                checked={ch.enabled}
                onCheckedChange={(v) => onToggleActive(v === true)}
                aria-label="Toggle channel active"
              />
            </Field>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
