import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Occasion } from '@/lib/api'
import { invalidateContactReminders } from '@/lib/prefs'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Occasion type control: the three built-ins plus a free-text "Custom…"
 *  (suggestions for it come from GET /occasions/types). */
const TYPE_ITEMS: { value: string; label: string }[] = [
  { value: 'otonan', label: 'Otonan (210-day Pawukon)' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'custom', label: 'Custom…' },
]

/** The recurrence a built-in type implies. "Custom…" has no entry — it keeps
 *  the user's current choice (untouched → yearly). */
const TYPE_RECURRENCE: Record<string, Occasion['recurrence']> = {
  otonan: 'otonan',
  birthday: 'yearly',
  anniversary: 'anniversary',
}

const RECURRENCE_ITEMS: { value: Occasion['recurrence']; label: string }[] = [
  { value: 'once', label: 'One-time' },
  { value: 'yearly', label: 'Every year' },
  { value: 'monthly', label: 'Every month' },
  { value: 'anniversary', label: 'Every year + every month' },
  { value: 'otonan', label: 'Otonan (every 210 days)' },
]

/** The add-an-occasion form, rendered inside OccasionsTab's dialog. Same
 *  fields and behavior as the original bottom-of-card section; on success it
 *  toasts, resets the entry fields (so several can be entered in a row), and
 *  calls onSaved — the host closes the dialog. */
export function AddOccasionForm({
  contactId,
  onSaved,
}: {
  contactId: string
  /** Called after a successful add — the host closes the dialog. */
  onSaved?: () => void
}) {
  const qc = useQueryClient()
  const [type, setType] = useState('otonan') // built-in value or 'custom'
  const [customType, setCustomType] = useState('') // free text when type === 'custom'
  const [recurrence, setRecurrence] = useState<Occasion['recurrence']>('yearly')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')

  const custom = type === 'custom'
  const effectiveType = custom ? customType.trim() : type

  // Built-in types imply their recurrence (birthday → yearly, otonan →
  // otonan, anniversary → anniversary); "Custom…" leaves the current pick.
  useEffect(() => {
    const auto = TYPE_RECURRENCE[type]
    if (auto) setRecurrence(auto)
  }, [type])

  // Custom-type suggestions: the caller's own previously used types (the
  // built-ins already have select options), fetched only while custom.
  const occasionTypes = useQuery({
    queryKey: ['occasion-types'],
    queryFn: () => api<{ types: string[] }>('/occasions/types'),
    enabled: custom,
  })
  const typeSuggestions = [...new Set(occasionTypes.data?.types ?? [])].filter(
    (t) => !TYPE_ITEMS.some((i) => i.value === t),
  )

  // Pawukon preview for otonan recurrences — recomputed when the date or the
  // recurrence changes, so switching a picked date to otonan updates it.
  useEffect(() => {
    setPawukon('')
    if (!date || recurrence !== 'otonan') return
    let alive = true
    api<{ label: string }>(`/pawukon?date=${date}`)
      .then((r) => {
        if (alive) setPawukon(r.label)
      })
      .catch(() => {
        /* stay silent */
      })
    return () => {
      alive = false
    }
  }, [date, recurrence])

  const addOcc = useMutation({
    mutationFn: () =>
      api(`/contacts/${contactId}/occasions`, {
        method: 'POST',
        body: JSON.stringify({ type: effectiveType, recurrence, date, label: label.trim() }),
      }),
    onSuccess: () => {
      setDate('')
      setDateSel(undefined)
      setPawukon('')
      setLabel('')
      setCustomType('')
      invalidateContactReminders(qc, contactId)
      toast.success('Occasion added')
      onSaved?.()
    },
    onError: (e) => toast.error(`Failed to add occasion: ${String(e)}`),
  })

  // flex-wrap: the w-56 controls share the row only when there is room and
  // stack on narrow viewports. Custom types reveal a free-text input in place,
  // with the previously used types as clickable suggestion chips underneath.
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={TYPE_ITEMS}
          value={type}
          onValueChange={(v) => {
            if (!v) return
            // "Custom…" falls back to yearly while the recurrence is still
            // the previous type's default — a manual pick is kept.
            if (v === 'custom' && recurrence === TYPE_RECURRENCE[type]) setRecurrence('yearly')
            setType(v)
          }}
        >
          <SelectTrigger className="w-56" aria-label="Occasion type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {TYPE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {custom && (
          <Input
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            placeholder="Custom type, e.g. graduation"
            aria-label="Custom occasion type"
            className="w-56"
          />
        )}
        <Select
          items={RECURRENCE_ITEMS}
          value={recurrence}
          onValueChange={(v) => {
            if (!v) return
            setRecurrence(v)
          }}
        >
          <SelectTrigger className="w-52" aria-label="Recurrence">
            <SelectValue placeholder="Recurrence" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {RECURRENCE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <DateSelectorPopover
          value={dateSel}
          onApply={(v) => {
            setDateSel(v)
            const d = dateSelectorValueToDate(v)
            setDate(d ? format(d, 'yyyy-MM-dd') : '')
          }}
          placeholder="Pick a date"
          minYear={1800}
          maxYear={new Date().getFullYear() + 10}
          weekStartsOn={1}
          allowRange={false}
          periodTypes={['day', 'month', 'year']}
          monthCascadesToDay
          showFilterTypes={false}
          className="w-56 justify-start"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label="Occasion label"
          className="w-44"
        />
        <Button disabled={!date || !effectiveType || addOcc.isPending} onClick={() => addOcc.mutate()}>
          Add
        </Button>
      </div>
      {custom && typeSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Previously used:</span>
          {typeSuggestions.map((t) => (
            <Button key={t} type="button" variant="outline" size="xs" onClick={() => setCustomType(t)}>
              {t}
            </Button>
          ))}
        </div>
      )}
      {pawukon && <p className="text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
      {effectiveType === 'birthday' && date.endsWith('-02-29') && (
        <p className="text-muted-foreground text-xs">Feb 29 in non-leap years is observed on March 1.</p>
      )}
    </div>
  )
}
