import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronRightIcon } from 'lucide-react'
import { api, type Channel, type Contact, type Occasion, type OccasionPrefs, type OffsetMap } from '@/lib/api'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** The streams a recurrence emits. The editor exposes ONE offsets value; a
 *  save writes it to every stream (once→event; yearly→event+yearly;
 *  monthly→event+monthly; anniversary→event+yearly+monthly; otonan→otonan)
 *  so users never face per-stream inputs. */
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
 * /occasions/{id}/prefs; the Custom reminders toggle OFF DELETEs the row so
 * the occasion falls back to the contact → settings chain. One offsets input
 * drives every stream the recurrence emits, and an empty list means inherit.
 *
 * Every handler composes its PUT from ONE authoritative local row (never from
 * the props, whose in-flight refetches lag behind the last edit), so
 * back-to-back actions — blur an offsets input then flip Active, toggle then
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

  const streams = STREAMS_FOR[occasion.recurrence]
  /** The single displayed offsets list: the first stream that carries one. */
  const savedOffsets = (): number[] => {
    for (const s of streams) {
      const list = row.offsets[s] ?? []
      if (list.length > 0) return list
    }
    return []
  }

  // Custom = the occasion carries its own override row (vs pure inherit).
  const [custom, setCustom] = useState(() => p != null)
  // The panel starts open only when the occasion already carries actual
  // overrides; a pinned-but-empty or inherit row stays collapsed.
  const [customOpen, setCustomOpen] = useState(
    () => streams.some((s) => (row.offsets[s] ?? []).length > 0) || row.channel_ids.length > 0,
  )
  /** Inherit ↔ custom. OFF deletes the override row entirely (the old
   *  "Reset to inherit"); ON pins a row so edits have something to land in. */
  const toggleCustom = (on: boolean) => {
    setCustom(on)
    if (on) {
      setCustomOpen(true)
      if (p == null) saveRow(rowRef.current)
    } else {
      setCustomOpen(false)
      commit(rowFrom(null))
      reset.mutate()
    }
  }

  // A resync from props must never run while one of our writes is in flight:
  // the refetch a previous PUT triggered can carry the pre-newer-edit row.
  const pendingRef = useRef(false)
  useEffect(() => {
    pendingRef.current = save.isPending || reset.isPending
  }, [save.isPending, reset.isPending])
  // Server state changed under us (our refetch after a write settles, another
  // editor, another tab) → adopt it, including the custom/inherit split.
  useEffect(() => {
    if (pendingRef.current) return
    syncFromServer(rowFrom(occasion.prefs))
    setCustom(occasion.prefs != null)
  }, [occasion.id, occasion.prefs, syncFromServer])

  /** Apply a local edit, then PUT the complete row from the updated state. */
  function saveRow(next: Row) {
    commit(next)
    save.mutate(next)
  }

  // The offsets input stays uncontrolled: typing must survive the refetch that
  // follows a save (a remount on every saved-value change would wipe a
  // half-typed edit). Keep the DOM in step with the row imperatively instead;
  // a focused input is left alone and reconciles itself on blur.
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const text = savedOffsets().join(', ')
    if (document.activeElement !== el && el.value !== text) el.value = text
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedOffsets reads row.offsets
  }, [row.offsets, streams])

  return (
    // c-frame-5: a frame with a collapsible panel — the header row toggles
    // the panel, the Switch beside it flips inherit ↔ custom.
    <Frame spacing="sm" stacked className="mt-2 [--frame-radius:var(--radius-lg)]">
      <FramePanel fit className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Reminders for this occasion</span>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={row.enabled}
            onCheckedChange={(v) => saveRow({ ...rowRef.current, enabled: v === true })}
          />
          Active
        </label>
      </FramePanel>
      <Collapsible open={customOpen} onOpenChange={setCustomOpen} className="group/collapsible">
        <FrameHeader className="flex flex-row items-center justify-between gap-2">
          <CollapsibleTrigger className="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <FrameTitle className="text-sm font-medium">Custom reminders</FrameTitle>
            <ChevronRightIcon
              aria-hidden="true"
              className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90"
            />
          </CollapsibleTrigger>
          <Switch
            checked={custom}
            disabled={reset.isPending || save.isPending}
            onCheckedChange={(v) => toggleCustom(v === true)}
            aria-label="Use custom reminders"
          />
        </FrameHeader>
        <CollapsibleContent>
          <FramePanel fit className="space-y-3">
            {/* One input for every stream the recurrence emits — the saved
                list is written to all of them on blur. */}
            <div className="space-y-1">
              <Label htmlFor={`occ-${occasion.id}-offsets`}>Days before</Label>
              <p className="text-muted-foreground text-xs">
                Comma-separated days before each reminder, e.g. 7, 3, 0. Empty = inherit from
                contact defaults.
              </p>
              <Input
                id={`occ-${occasion.id}-offsets`}
                ref={(el) => {
                  inputRef.current = el
                }}
                // Uncontrolled: mount-time value only, the effect above syncs it.
                defaultValue={savedOffsets().join(', ')}
                placeholder="inherit"
                onBlur={(e) => {
                  const el = e.target
                  const list = el.value
                    .split(',')
                    .map((x) => parseInt(x.trim(), 10))
                    .filter((n) => !Number.isNaN(n))
                  const shown = savedOffsets()
                  // Blur without an edit must not create an override row or
                  // flatten differing per-stream values; just re-canonicalize.
                  if (list.join(',') === shown.join(',')) {
                    el.value = shown.join(', ')
                    return
                  }
                  const offsets: OffsetMap = list.length
                    ? Object.fromEntries(streams.map((s) => [s, list]))
                    : {}
                  saveRow({ ...rowRef.current, offsets })
                }}
              />
            </div>
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
            <p className="text-muted-foreground text-xs">
              Turn Custom reminders off to inherit everything from the contact.
            </p>
          </FramePanel>
        </CollapsibleContent>
      </Collapsible>
    </Frame>
  )
}
