import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Occasion } from '@/lib/api'
import { invalidateContactReminders } from '@/lib/prefs'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
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

/** Add-or-edit occasion form, rendered inside OccasionsTab's dialogs. With
 *  `occasion` it edits: fields initialize from the row and a save PATCHes it;
 *  without, it adds via POST and resets so several can be entered in a row.
 *  Both call onSaved after success — the host closes the dialog. */
export function OccasionForm({
  contactId,
  occasion,
  onSaved,
}: {
  contactId: string
  /** Present → edit this occasion instead of adding a new one. */
  occasion?: Occasion
  /** Called after a successful save — the host closes the dialog. */
  onSaved?: () => void
}) {
  const editing = occasion !== undefined
  const qc = useQueryClient()
  const [type, setType] = useState(() => {
    if (!occasion) return 'otonan' // built-in value or 'custom'
    return TYPE_ITEMS.some((i) => i.value === occasion.type) ? occasion.type : 'custom'
  })
  const [customType, setCustomType] = useState(
    () => occasion?.type ?? '', // free text when type === 'custom'
  )
  const [recurrence, setRecurrence] = useState<Occasion['recurrence']>(
    () => occasion?.recurrence ?? 'yearly',
  )
  const [label, setLabel] = useState(() => occasion?.label ?? '')
  const [date, setDate] = useState(() => occasion?.base_date ?? '')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(() =>
    // Edit mode: seed the picker so it shows the loaded date, not the placeholder.
    occasion ? { period: 'day', operator: 'is', startDate: parseISO(occasion.base_date) } : undefined,
  )
  const [pawukon, setPawukon] = useState('')

  const custom = type === 'custom'
  const effectiveType = custom ? customType.trim() : type

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

  const saveOcc = useMutation({
    mutationFn: () =>
      editing
        ? api(`/occasions/${occasion.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ type: effectiveType, recurrence, date, label: label.trim() }),
          })
        : api(`/contacts/${contactId}/occasions`, {
            method: 'POST',
            body: JSON.stringify({ type: effectiveType, recurrence, date, label: label.trim() }),
          }),
    onSuccess: () => {
      if (!editing) {
        setDate('')
        setDateSel(undefined)
        setPawukon('')
        setLabel('')
        setCustomType('')
      }
      invalidateContactReminders(qc, contactId)
      toast.success(editing ? 'Occasion updated' : 'Occasion added')
      onSaved?.()
    },
    onError: (e) => toast.error(`Failed to ${editing ? 'update' : 'add'} occasion: ${String(e)}`),
  })

  // Dialog body + footer action — the DialogFooter primitive gives the same
  // full-bleed muted band as the other dialogs (event detail, day events).
  // Wrapped in a form so Enter in the text inputs submits; the select and
  // date triggers keep Enter for opening their own popups (focus sits on
  // their buttons, which never triggers implicit submission).
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!date || !effectiveType || saveOcc.isPending) return
        saveOcc.mutate()
      }}
    >
      {/* pb-5: extra air between the last field and the footer band. */}
      <div className="pb-5 text-sm">
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="occ-type">Type</FieldLabel>
              <Select
                items={TYPE_ITEMS}
                value={type}
                onValueChange={(v) => {
                  if (!v || v === type) return
                  // Built-in types imply their recurrence (birthday → yearly,
                  // otonan → otonan, anniversary → anniversary) — only on a
                  // user pick, never on mount, so an edit form's loaded
                  // recurrence (e.g. a birthday set to monthly) survives.
                  // "Custom…" keeps the current pick unless it is still the
                  // previous type's default, which falls back to yearly.
                  if (v === 'custom') {
                    if (recurrence === TYPE_RECURRENCE[type]) setRecurrence('yearly')
                  } else {
                    setRecurrence(TYPE_RECURRENCE[v])
                  }
                  setType(v)
                }}
              >
                <SelectTrigger id="occ-type" className="w-full">
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
            </Field>
            <Field>
              <FieldLabel htmlFor="occ-recurrence">Recurrence</FieldLabel>
              <Select
                items={RECURRENCE_ITEMS}
                value={recurrence}
                onValueChange={(v) => {
                  if (!v) return
                  setRecurrence(v)
                }}
              >
                <SelectTrigger id="occ-recurrence" className="w-full">
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
              <FieldDescription>Follows the type — change to override.</FieldDescription>
            </Field>
          {custom && (
            <Field>
              <FieldLabel htmlFor="occ-custom">Custom type</FieldLabel>
              <Input
                id="occ-custom"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                placeholder="e.g. graduation"
              />
              {typeSuggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-muted-foreground text-xs">Previously used:</span>
                  {typeSuggestions.map((t) => (
                    <Button key={t} type="button" variant="outline" size="xs" onClick={() => setCustomType(t)}>
                      {t}
                    </Button>
                  ))}
                </div>
              )}
            </Field>
          )}
          <Field>
            <FieldTitle>Date</FieldTitle>
              <DateSelectorPopover
                value={dateSel}
                onApply={(v) => {
                  setDateSel(v)
                  const d = dateSelectorValueToDate(v)
                  setDate(d ? format(d, 'yyyy-MM-dd') : '')
                }}
                autoApply
                placeholder="Pick a date"
                minYear={1800}
                maxYear={new Date().getFullYear() + 10}
                weekStartsOn={1}
                allowRange={false}
                periodTypes={['day', 'month', 'year']}
                monthCascadesToDay
                showFilterTypes={false}
                className="w-full justify-start"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="occ-label">Label</FieldLabel>
              <Input
                id="occ-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Optional, e.g. Wedding"
              />
            </Field>
          {pawukon && <p className="text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
          {effectiveType === 'birthday' && date.endsWith('-02-29') && (
            <p className="text-muted-foreground text-xs">Feb 29 in non-leap years is observed on March 1.</p>
          )}
        </FieldGroup>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!date || !effectiveType || saveOcc.isPending}>
          {editing ? 'Save changes' : 'Add occasion'}
        </Button>
      </DialogFooter>
    </form>
  )
}
