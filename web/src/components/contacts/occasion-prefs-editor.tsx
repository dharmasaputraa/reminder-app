import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Channel, type Occasion, type OccasionPrefs, type OffsetMap } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** One label per recurrence stream, in the order the editor renders them. */
const STREAM_LABELS: Record<string, string> = {
  event: 'Event (the base date)',
  yearly: 'Yearly marks',
  monthly: 'Monthly marks',
  otonan: 'Otonan marks',
}

/** The streams a recurrence emits — only these get an offsets input:
 *  once→event; yearly→event+yearly; monthly→event+monthly;
 *  anniversary→event+yearly+monthly; otonan→otonan. */
const STREAMS_FOR: Record<Occasion['recurrence'], string[]> = {
  once: ['event'],
  yearly: ['event', 'yearly'],
  monthly: ['event', 'monthly'],
  anniversary: ['event', 'yearly', 'monthly'],
  otonan: ['otonan'],
}

/**
 * Per-occasion reminder overrides. The API is a full-replace PUT to
 * /occasions/{id}/prefs; "Reset to inherit" DELETEs the override row so the
 * occasion falls back to the contact → settings chain. Only the streams the
 * occasion's recurrence emits are editable, and an empty list means inherit.
 */
export function OccasionPrefsEditor({
  contactId,
  occasion,
  channels,
}: {
  contactId: string
  occasion: Occasion
  channels: Channel[]
}) {
  const qc = useQueryClient()
  const p = occasion.prefs
  const streams: OffsetMap = p?.offsets ?? {}
  // Local mirrors of the override row: a toggle applies its own previous
  // change while the invalidated refetch is still in flight, and re-syncs
  // whenever the server row changes (identity-stable between refetches).
  const [enabled, setEnabled] = useState(p?.enabled ?? true)
  const [channelIds, setChannelIds] = useState<string[]>(p?.channel_ids ?? [])
  useEffect(() => {
    setEnabled(p?.enabled ?? true)
    setChannelIds(p?.channel_ids ?? [])
  }, [occasion.id, p])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', contactId] })
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }
  const save = useMutation({
    mutationFn: (body: { offsets: OffsetMap; channel_ids: string[]; enabled: boolean }) =>
      api<OccasionPrefs>(`/occasions/${occasion.id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Failed to save: ${String(e)}`),
  })
  const reset = useMutation({
    mutationFn: () => api(`/occasions/${occasion.id}/prefs`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Failed to reset: ${String(e)}`),
  })

  /** Full-replace PUT seeded from the current row plus the local mirrors. */
  function put(offsets: OffsetMap, patch?: { channel_ids?: string[]; enabled?: boolean }) {
    save.mutate({
      offsets,
      channel_ids: patch?.channel_ids ?? channelIds,
      enabled: patch?.enabled ?? enabled,
    })
  }

  return (
    <div className="bg-muted/40 mt-2 space-y-3 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Reminders for this occasion</span>
        {p && (
          <Button variant="ghost" size="sm" disabled={reset.isPending} onClick={() => reset.mutate()}>
            Reset to inherit
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            const next = v === true
            setEnabled(next)
            put(streams, { enabled: next })
          }}
        />
        Active
      </label>
      {STREAMS_FOR[occasion.recurrence].map((s) => {
        const saved = (streams[s] ?? []).join(', ')
        return (
          <div key={s} className="space-y-1">
            <Label htmlFor={`occ-${occasion.id}-${s}`}>{STREAM_LABELS[s]}</Label>
            <Input
              id={`occ-${occasion.id}-${s}`}
              // Remount when the saved list changes: a save normalizes the
              // text, reset clears it back to the inherit placeholder.
              key={saved}
              defaultValue={saved}
              placeholder="inherit"
              onBlur={(e) => {
                const list = e.target.value
                  .split(',')
                  .map((x) => parseInt(x.trim(), 10))
                  .filter((n) => !Number.isNaN(n))
                // Blur without an edit must not create an override row.
                if (list.join(',') === (streams[s] ?? []).join(',')) return
                put({ ...streams, [s]: list })
              }}
              className="max-w-xs"
            />
          </div>
        )
      })}
      {channels.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Channels</div>
          <div className="flex flex-wrap gap-2">
            {channels.map((ch) => (
              <label key={ch.id} className="bg-muted flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm">
                <Checkbox
                  checked={channelIds.includes(ch.id)}
                  onCheckedChange={(v) => {
                    const next = v === true ? [...channelIds, ch.id] : channelIds.filter((id) => id !== ch.id)
                    setChannelIds(next)
                    put(streams, { channel_ids: next })
                  }}
                />
                {ch.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <p className="text-muted-foreground text-xs">Empty = inherit from contact defaults.</p>
    </div>
  )
}
