import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from 'cn'
import { ChevronRightIcon } from 'lucide-react'
import { api, type Channel, type Contact, type Occasion, type OccasionPrefs, type OffsetMap } from '@/lib/api'
import { ChannelChip } from '@/components/channel-chip'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  custom: boolean
}

/** The server's row (or the inherit-all default when there is none). */
function rowFrom(p: OccasionPrefs | null | undefined): Row {
  return {
    offsets: p?.offsets ?? {},
    channel_ids: p?.channel_ids ?? [],
    enabled: p?.enabled ?? true,
    custom: p?.custom ?? false,
  }
}

/** Value equality — a resync that changes nothing must not churn the UI. */
function sameRow(a: Row, b: Row): boolean {
  const keysA = Object.keys(a.offsets)
  const keysB = Object.keys(b.offsets)
  return (
    a.enabled === b.enabled &&
    a.custom === b.custom &&
    a.channel_ids.length === b.channel_ids.length &&
    a.channel_ids.every((id, i) => id === b.channel_ids[i]) &&
    keysA.length === keysB.length &&
    keysA.every((k) => (a.offsets[k] ?? []).join(',') === (b.offsets[k] ?? []).join(','))
  )
}

/**
 * Per-occasion reminder overrides. The API is a full-replace PUT to
 * /occasions/{id}/prefs; the Custom reminders toggle never deletes the row —
 * turning it off (or pausing the occasion) only flips a flag and asks for
 * confirmation first, so the saved days and channels are retained and come
 * back when the override is re-enabled. One offsets input drives every stream
 * the recurrence emits, and an empty list means inherit.
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
  paused,
  onPausedInteraction,
}: {
  contactId: string
  occasion: Occasion
  channels: Channel[]
  /** Contact-level master switch is off: every switch here is locked. */
  paused: boolean
  /** A locked switch was clicked — the parent opens the force-activate dialog. */
  onPausedInteraction: () => void
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
      // edit — including the custom flag — so the mirrors match what is
      // actually stored.
      if (rowRef.current === vars) {
        const stored = serverRow()
        syncFromServer(stored)
        setCustom(stored.custom)
        // A reverted flip to inherit must also collapse the panel, exactly as
        // a server resync does: the trigger is disabled while custom is off,
        // which would otherwise leave a live panel with no way to close it.
        if (!stored.custom) setCustomOpen(false)
      }
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
  /** What the inactive row retains, e.g. "Saved: 7, 3, 0 · 2 channels". */
  const savedHint = (): string => {
    const parts: string[] = []
    const offs = savedOffsets()
    if (offs.length > 0) parts.push(offs.join(', '))
    if (row.channel_ids.length > 0) parts.push(`${row.channel_ids.length} channel${row.channel_ids.length === 1 ? '' : 's'}`)
    return parts.length > 0 ? `Saved: ${parts.join(' · ')}` : ''
  }

  // Custom = the occasion's override values are live (vs retained-but-inactive).
  const [custom, setCustom] = useState(() => p?.custom ?? false)
  // The panel starts open only when the occasion carries actual values.
  const [customOpen, setCustomOpen] = useState(
    () => (p?.custom ?? false) && (streams.some((s) => (row.offsets[s] ?? []).length > 0) || row.channel_ids.length > 0),
  )
  // Pending disable awaiting confirmation: which switch was toggled off.
  const [confirm, setConfirm] = useState<null | 'occasion' | 'custom'>(null)

  /** Inherit ↔ custom. OFF asks first; the values stay on the row either way. */
  const toggleCustom = (on: boolean) => {
    if (paused) {
      onPausedInteraction()
      return
    }
    if (on) {
      setCustomOpen(true)
      setCustom(true)
      if (!rowRef.current.custom) saveRow({ ...rowRef.current, custom: true })
    } else {
      setConfirm('custom')
    }
  }

  /** The confirmed disable: save the flag, keep the data. */
  const confirmDisable = () => {
    const kind = confirm
    setConfirm(null)
    if (kind === 'custom') {
      setCustom(false)
      setCustomOpen(false)
      saveRow({ ...rowRef.current, custom: false })
    } else if (kind === 'occasion') {
      saveRow({ ...rowRef.current, enabled: false })
    }
  }

  // A resync from props must never run while one of our writes is in flight:
  // the refetch a previous PUT triggered can carry the pre-newer-edit row.
  const pendingRef = useRef(false)
  useEffect(() => {
    pendingRef.current = save.isPending
  }, [save.isPending])
  // Server state changed under us (our refetch after a write settles, another
  // editor, another tab) → adopt it, including the custom/inherit split.
  useEffect(() => {
    if (pendingRef.current) return
    syncFromServer(rowFrom(occasion.prefs))
    const nextCustom = occasion.prefs?.custom ?? false
    setCustom(nextCustom)
    // A server-side flip to inherit must also collapse the panel: the trigger
    // is disabled while custom is off.
    if (!nextCustom) setCustomOpen(false)
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
        {/* A span, not a label: a wrapping <label> forwards a second click to
            the Switch's hidden form input, firing onCheckedChange twice with
            opposite values. The Switch carries its own aria-label instead. */}
        <span className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={row.enabled}
            aria-disabled={paused || undefined}
            className={cn(paused && 'opacity-50')}
            onCheckedChange={(v) => {
              if (paused) {
                onPausedInteraction()
                return
              }
              if (v) saveRow({ ...rowRef.current, enabled: true })
              else setConfirm('occasion')
            }}
            aria-label="Toggle reminders for this occasion"
          />
          {row.enabled ? 'Active' : 'Inactive'}
        </span>
      </FramePanel>
      <Collapsible open={customOpen} onOpenChange={setCustomOpen} className="group/collapsible">
        <FrameHeader className="flex flex-row items-center justify-between gap-2">
          <CollapsibleTrigger
            disabled={!custom}
            className="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
          >
            <FrameTitle className="text-sm font-medium">{custom ? 'Custom reminders' : 'Inherit reminders'}</FrameTitle>
            {custom && (
              <ChevronRightIcon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90"
              />
            )}
          </CollapsibleTrigger>
          <Switch
            checked={custom}
            disabled={save.isPending}
            aria-disabled={paused || undefined}
            className={cn(paused && 'opacity-50')}
            onCheckedChange={(v) => toggleCustom(v === true)}
            aria-label="Use custom reminders"
          />
        </FrameHeader>
        {!custom && savedHint() !== '' && (
          <FramePanel fit className="text-muted-foreground text-xs">{savedHint()}</FramePanel>
        )}
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
                  {channels.map((ch) => {
                    const checked = row.channel_ids.includes(ch.id)
                    return (
                      <ChannelChip
                        key={ch.id}
                        channel={ch}
                        checked={checked}
                        onToggle={() => {
                          const cur = rowRef.current.channel_ids
                          const next = checked ? cur.filter((id) => id !== ch.id) : [...cur, ch.id]
                          saveRow({ ...rowRef.current, channel_ids: next })
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              Turn off to inherit from the contact — saved days and channels are kept for when you turn it back on.
            </p>
          </FramePanel>
        </CollapsibleContent>
      </Collapsible>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'custom' ? 'Switch to inherit reminders?' : 'Pause reminders for this occasion?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'custom'
                ? 'The occasion will use the contact defaults. Saved days and channels are kept and restored when you re-enable custom reminders.'
                : 'This occasion sends no notifications until you turn it back on.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable}>
              {confirm === 'custom' ? 'Switch to inherit' : 'Pause'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  )
}
