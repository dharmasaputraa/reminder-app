import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Settings } from '@/lib/api'
import { parseList } from '@/lib/prefs'
import { TimezoneSelect } from '@/components/settings/timezone-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const KATEGORI = [
  { key: 'pawukon', label: 'Pawukon holidays (computed locally)' },
  { key: 'saka', label: 'Balinese & Saka holidays (API)' },
  { key: 'national', label: 'National holidays (API)' },
]

/** Per-stream fallback offsets. Every stream needs a non-empty list — the
 *  backend rejects an empty one (it would make the fallback meaningless). */
const RECURRENCE_STREAMS = [
  { key: 'event', label: 'Event (base date)', placeholder: '30,7,4,2,1,0' },
  { key: 'yearly', label: 'Yearly marks', placeholder: '30,7,4,2,1,0' },
  { key: 'monthly', label: 'Monthly marks', placeholder: '0' },
  { key: 'otonan', label: 'Otonan marks', placeholder: '7,4,2,1,0' },
]

/** The settings form — both cards, one Save. Owns the settings/me queries,
 *  the text-field state, and the PUT; the route only supplies the title. */
export function SettingsPageContent() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const [form, setForm] = useState<Settings | null>(null)
  const [offsetsText, setOffsetsText] = useState('')
  const [holidayOffsetTexts, setHolidayOffsetTexts] = useState<Record<string, string>>({})
  const [recurrenceTexts, setRecurrenceTexts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (q.data && !form) {
      setForm(q.data)
      setOffsetsText(q.data.default_offsets.join(','))
      const texts: Record<string, string> = {}
      for (const k of KATEGORI) {
        const offs = q.data.holiday_offsets?.[k.key]
        if (offs?.length) texts[k.key] = offs.join(',')
      }
      setHolidayOffsetTexts(texts)
      // The GET always carries all four streams (stored blob or defaults).
      setRecurrenceTexts(
        Object.fromEntries(
          RECURRENCE_STREAMS.map((s) => [s.key, (q.data!.recurrence_offsets?.[s.key] ?? []).join(',')]),
        ),
      )
    }
  }, [q.data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api('/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error(`Failed to save: ${String(e)}`),
  })

  if (!form && q.isError)
    return (
      <p className="text-sm text-red-600">
        Failed to load settings: {String(q.error)} — check your login/dev email, then reload the page.
      </p>
    )
  if (!form)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[430px] w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })
  const recurrenceOffsets: Record<string, number[]> = Object.fromEntries(
    RECURRENCE_STREAMS.map((s) => [s.key, parseList(recurrenceTexts[s.key] ?? '')]),
  )
  const recurrenceOffsetsValid = RECURRENCE_STREAMS.every((s) => (recurrenceOffsets[s.key] ?? []).length > 0)
  const saveNow = () => {
    const holiday_offsets: Record<string, number[]> = {}
    for (const k of KATEGORI) {
      const raw = holidayOffsetTexts[k.key]?.trim()
      if (raw) {
        holiday_offsets[k.key] = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
      }
    }
    save.mutate({
      ...form,
      default_offsets: offsetsText.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)),
      holiday_offsets,
      // Required by the API — the old frontend omitted it and every settings
      // PUT 400ed; all four lists ride along with every save.
      recurrence_offsets: recurrenceOffsets,
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reminder Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Timezone</FieldLabel>
            <TimezoneSelect value={form.timezone} onChange={(tz) => set({ timezone: tz })} />
            <FieldDescription>Sets "today" for the calendar and the reminder send time.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="send-time">Send time (HH:MM)</FieldLabel>
            <Input id="send-time" value={form.send_time} onChange={(e) => set({ send_time: e.target.value })} />
          </Field>

          <Field>
            <FieldLabel htmlFor="catch-up">Catch-up window (hours)</FieldLabel>
            <Input
              id="catch-up"
              type="number"
              value={form.catch_up_hours}
              onChange={(e) => set({ catch_up_hours: Number(e.target.value) })}
            />
            <FieldDescription>Reminders missed while the device was off.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="offsets">Default offsets (days before D, comma-separated)</FieldLabel>
            <Input id="offsets" value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} />
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Holiday reminder categories</legend>
            {KATEGORI.map((k) => {
              const enabled = form.holiday_categories[k.key] ?? false
              return (
                <div key={k.key} className="space-y-1.5 rounded-lg border p-2.5">
                  {/* A span, not a label: a wrapping <label> forwards a second,
                      opposite click to the Checkbox's hidden input. The Checkbox
                      carries its own aria-label instead. */}
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(c) => set({ holiday_categories: { ...form.holiday_categories, [k.key]: c === true } })}
                      aria-label={`Toggle ${k.label} holiday reminders`}
                    />
                    {k.label}
                  </span>
                  <div className="ps-6">
                    <Field>
                      <FieldLabel htmlFor={`holiday-offsets-${k.key}`} className="text-xs">
                        Reminder offsets (days before, e.g. 7,1,0)
                      </FieldLabel>
                      <Input
                        id={`holiday-offsets-${k.key}`}
                        value={holidayOffsetTexts[k.key] ?? ''}
                        onChange={(e) => setHolidayOffsetTexts((s) => ({ ...s, [k.key]: e.target.value }))}
                        placeholder={`default: ${offsetsText}`}
                        disabled={!enabled}
                        className="h-7 w-40 text-xs"
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Unchecked sources stop notifying and are hidden from the calendar.
                Empty offsets fall back to the default offsets above.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  set({ holiday_categories: { pawukon: true, saka: true, national: true } })
                  setHolidayOffsetTexts({})
                }}
              >
                Reset to default
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurrence offsets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Default reminder offsets per occurrence stream, used when neither the occasion nor the
            contact sets a list. Days before the date, comma-separated; every stream needs at least
            one offset (0 = on the day). Saved with the Settings above.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RECURRENCE_STREAMS.map((s) => (
              <Field key={s.key}>
                <FieldLabel htmlFor={`rec-offsets-${s.key}`}>{s.label}</FieldLabel>
                <Input
                  id={`rec-offsets-${s.key}`}
                  value={recurrenceTexts[s.key] ?? ''}
                  onChange={(e) => setRecurrenceTexts((t) => ({ ...t, [s.key]: e.target.value }))}
                  placeholder={s.placeholder}
                />
              </Field>
            ))}
          </div>
          {!recurrenceOffsetsValid && (
            <p className="text-sm text-red-600">Every stream needs at least one offset.</p>
          )}
        </CardContent>
      </Card>

      {/* One Save for both cards — they share the settings PUT. */}
      <Button onClick={saveNow} disabled={save.isPending || !recurrenceOffsetsValid}>Save</Button>

      {me.data && (
        <p className="text-sm text-muted-foreground">
          Signed in as <b>{me.data.email}</b> ({me.data.role}) — dev mode via the X-Dev-Email header;
          production via Cloudflare Access.
        </p>
      )}
    </div>
  )
}
