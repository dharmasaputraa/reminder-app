import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Channel, type Contact, type Occasion, type OccasionPrefs, type OffsetMap } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** One label + explainer per recurrence stream, in the order the editor
 *  renders them. "Base date" is the occasion's exact date; the other streams
 *  repeat on their own cycle, and each stream takes its own offset set. */
const STREAMS: Record<string, { label: string; hint: string }> = {
  event: { label: 'Base date', hint: 'Reminders counting down to the date itself' },
  yearly: { label: 'Yearly', hint: 'Reminders before each yearly anniversary of the date' },
  monthly: { label: 'Monthly', hint: 'Reminders before each monthly mark of the date' },
  otonan: { label: 'Otonan', hint: 'Reminders before each 210-day Pawukon cycle of the date' },
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

/** The whole override row — exactly the wire shape of the full-replace PUT. */
interface Row {
  offsets: OffsetMap
  channel_ids: string[]
  enabled: boolean
}

/** The server's row (or the inherit-all default when there is none). */
function rowFrom(p: OccasionPrefs | null | undefined): Row {
  return { offsets: p?.offsets ?? {}, channel_ids: p?.channel_ids ?? [], enabled: p?.enabled ?? true }
}

/** Value equality — a resync that changes nothing must not churn the UI. */
function sameRow(a: Row, b: Row): boolean {
  const keysA = Object.keys(a.offsets)
  const keysB = Object.keys(b.offsets)
  return (
    a.enabled === b.enabled &&
    a.channel_ids.length === b.channel_ids.length &&
    a.channel_ids.every((id, i) => id === b.channel_ids[i]) &&
    keysA.length === keysB.length &&
    keysA.every((k) => (a.offsets[k] ?? []).join(',') === (b.offsets[k] ?? []).join(','))
  )
}

/**
 * Per-occasion reminder overrides. The API is a full-replace PUT to
 * /occasions/{id}/prefs; "Reset to inherit" DELETEs the override row so the
 * occasion falls back to the contact → settings chain. Only the streams the
 * occasion's recurrence emits are editable, and an empty list means inherit.
 *
 * Every handler composes its PUT from ONE authoritative local row (never from
 * the props, whose in-flight refetches lag behind the last edit), so
 * back-to-back actions — blur an offsets input then flip Active, reset then
 * check a channel — cannot send a stale full-replace body that silently
 * reverts the previous action.
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
  // The authoritative local row: `row` drives the UI, `rowRef` mirrors it so
  // handlers read each other's writes before React re-renders (blur → click).
  const [row, setRow] = useState<Row>(() => rowFrom(p))
  const rowRef = useRef(row)
  const commit = useCallback((next: Row) => {
    rowRef.current = next
    setRow(next)
  }, [])

  // The server's current row: the cached contact is fresher than the props
  // whenever a refetch has landed, the props are the fallback.
  const serverRow = useCallback((): Row => {
    const occ = qc.getQueryData<Contact>(['contact', contactId])?.occasions.find((o) => o.id === occasion.id)
    return rowFrom(occ ? occ.prefs : p)
  }, [qc, contactId, occasion.id, p])

  /** Adopt the server's row, skipping no-op resyncs. */
  const syncFromServer = useCallback(
    (next: Row) => {
      if (!sameRow(rowRef.current, next)) commit(next)
    },
    [commit],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', contactId] })
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }
  const save = useMutation({
    mutationFn: (body: Row) =>
      api<OccasionPrefs>(`/occasions/${occasion.id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    // Adopt the server's normalized row — unless a newer edit was queued while
    // this request was in flight; that newer request's response is the final
    // state, and its own success handler will adopt it.
    onSuccess: (saved, vars) => {
      if (rowRef.current === vars) syncFromServer(rowFrom(saved))
      invalidate()
    },
    onError: (e, vars) => {
      toast.error(`Failed to save: ${String(e)}`)
      // A failed PUT leaves the server at its old row: drop the optimistic
      // edit so the mirrors match what is actually stored.
      if (rowRef.current === vars) syncFromServer(serverRow())
      invalidate()
    },
  })
  const reset = useMutation({
    mutationFn: () => api(`/occasions/${occasion.id}/prefs`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => {
      toast.error(`Failed to reset: ${String(e)}`)
      syncFromServer(serverRow())
      invalidate()
    },
  })

  // A resync from props must never run while one of our writes is in flight:
  // the refetch a previous PUT triggered can carry the pre-newer-edit row.
  const pendingRef = useRef(false)
  useEffect(() => {
    pendingRef.current = save.isPending || reset.isPending
  }, [save.isPending, reset.isPending])
  // Server state changed under us (our refetch after a write settles, another
  // editor, another tab) → adopt it.
  useEffect(() => {
    if (pendingRef.current) return
    syncFromServer(rowFrom(occasion.prefs))
  }, [occasion.id, occasion.prefs, syncFromServer])

  /** Apply a local edit, then PUT the complete row from the updated state. */
  function saveRow(next: Row) {
    commit(next)
    save.mutate(next)
  }

  // The offsets inputs stay uncontrolled: typing must survive the refetch that
  // follows a save (a remount on every saved-value change would wipe a
  // half-typed edit). Keep the DOM in step with the row imperatively instead;
  // a focused input is left alone and reconciles itself on blur.
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const streams = STREAMS_FOR[occasion.recurrence]
  useEffect(() => {
    for (const s of streams) {
      const el = inputRefs.current[s]
      const saved = (row.offsets[s] ?? []).join(', ')
      if (el && document.activeElement !== el && el.value !== saved) el.value = saved
    }
  }, [row.offsets, streams])

  return (
    <div className="bg-muted/40 mt-2 space-y-3 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Reminders for this occasion</span>
        {p && (
          <Button
            variant="ghost"
            size="sm"
            disabled={reset.isPending}
            onClick={() => {
              // Back to inherit — and a later edit in the refetch window must
              // compose from the inherit row, not from the deleted one.
              commit(rowFrom(null))
              reset.mutate()
            }}
          >
            Reset to inherit
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch
          checked={row.enabled}
          onCheckedChange={(v) => saveRow({ ...rowRef.current, enabled: v === true })}
        />
        Active
      </label>
      {streams.map((s) => {
        const stream = STREAMS[s]
        return (
          <div key={s} className="space-y-1">
            <Label htmlFor={`occ-${occasion.id}-${s}`}>{stream.label}</Label>
            <p className="text-muted-foreground text-xs">{stream.hint}</p>
            <Input
              id={`occ-${occasion.id}-${s}`}
              ref={(el) => {
                inputRefs.current[s] = el
              }}
              // Uncontrolled: mount-time value only, the effect above syncs it.
              defaultValue={(row.offsets[s] ?? []).join(', ')}
              placeholder="inherit"
              onBlur={(e) => {
                const el = e.target
                const saved = rowRef.current.offsets[s] ?? []
                const list = el.value
                  .split(',')
                  .map((x) => parseInt(x.trim(), 10))
                  .filter((n) => !Number.isNaN(n))
                // Blur without an edit must not create an override row; just
                // re-canonicalize the text ("5,3" → "5, 3").
                if (list.join(',') === saved.join(',')) {
                  el.value = saved.join(', ')
                  return
                }
                saveRow({ ...rowRef.current, offsets: { ...rowRef.current.offsets, [s]: list } })
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
                  checked={row.channel_ids.includes(ch.id)}
                  onCheckedChange={(v) => {
                    const cur = rowRef.current.channel_ids
                    const next = v === true ? [...cur, ch.id] : cur.filter((id) => id !== ch.id)
                    saveRow({ ...rowRef.current, channel_ids: next })
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
