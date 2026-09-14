import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Channel, type Contact, type Settings } from '../lib/api'
import { hydratePrefsForm } from '../lib/prefs'
import { pageTitle } from '../lib/page-title'
import {
  DateSelectorPopover,
  dateSelectorValueToDate,
} from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/reminder/contacts/$id')({
  component: ContactDetail,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

const TIPE: { value: string; label: string }[] = [
  { value: 'otonan', label: 'Otonan (210-day Pawukon)' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
]

/** ISO yyyy-MM-dd → "18/06/2003 (Wednesday, 18 June 2003)". */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'dd/MM/yyyy (EEEE, d MMMM yyyy)')
}

function ContactDetail() {
  const { id } = Route.useParams()
  const qc = useQueryClient()
  const nav = useNavigate()
  const contact = useQuery({ queryKey: ['contact', id], queryFn: () => api<Contact>(`/contacts/${id}`) })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  const [type, setType] = useState('otonan')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')
  const [offsets, setOffsets] = useState('')
  const [enabled, setEnabled] = useState(true)

  // Hydrate the form when contact data loads/changes (including refetch after invalidate).
  useEffect(() => {
    if (!contact.data) return
    const form = hydratePrefsForm(contact.data.prefs)
    setOffsets(form.offsets)
    setEnabled(form.enabled)
  }, [contact.data])

  async function previewPawukon(d: string) {
    setPawukon('')
    if (!d || type !== 'otonan') return
    try { setPawukon((await api<{ label: string }>(`/pawukon?date=${d}`)).label) } catch { /* stay silent */ }
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }
  const addOcc = useMutation({
    mutationFn: () => api(`/contacts/${id}/occasions`, { method: 'POST', body: JSON.stringify({ type, date }) }),
    onSuccess: () => { setDate(''); setDateSel(undefined); setPawukon(''); invalidate() },
  })
  const delOcc = useMutation({
    mutationFn: (oid: number) => api(`/occasions/${oid}`, { method: 'DELETE' }), onSuccess: invalidate,
  })
  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/contacts/${id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Failed to save preferences: ${String(e)}`),
  })
  const delContact = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => nav({ to: '/reminder/contacts' }),
  })

  if (contact.isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (contact.isError) return <p className="text-red-600">{String(contact.error)}</p>
  const c = contact.data!

  // One occasion per type: types the contact already has are disabled in the
  // type select (c-select-7 disabled-item pattern) and the Add button locks.
  const existingTypes = new Set(c.occasions.map((o) => o.type))
  const typeItems = TIPE.map((t) => ({
    label: t.label,
    value: t.value,
    disabled: existingTypes.has(t.value),
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{c.name}</h1>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm">Delete contact</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                All occasions and reminder preferences for this contact will be deleted too.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => delContact.mutate()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Occasions</CardTitle>
        </CardHeader>
        <CardContent>
          {c.occasions.map((o) => (
            <div key={o.id} className="flex items-center justify-between border-b py-2 text-sm">
              <span className="flex items-center gap-2">
                <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                {longDate(o.base_date)}
              </span>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="destructive" size="sm">Delete</Button>} />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {o.type} {o.base_date} will be permanently deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => delOcc.mutate(o.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              items={typeItems}
              value={type}
              onValueChange={(v) => {
                if (!v) return
                setType(v)
              }}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {typeItems.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={item.disabled}
                    >
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
                const iso = d ? format(d, 'yyyy-MM-dd') : ''
                setDate(iso)
                previewPawukon(iso)
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
            <Button disabled={!date || existingTypes.has(type) || addOcc.isPending} onClick={() => addOcc.mutate()}>Add</Button>
          </div>
          {existingTypes.has(type) && (
            <p className="mt-2 text-xs text-muted-foreground">
              This contact already has this type of occasion — only one of each type is allowed.
            </p>
          )}
          {pawukon && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
          {type === 'birthday' && date.endsWith('-02-29') && (
            <p className="mt-2 text-xs text-muted-foreground">Feb 29 in non-leap years is observed on March 1.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reminder Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm text-muted-foreground">
            Global default: {(settings.data?.default_offsets ?? []).map((n) => `D-${n}`).join(', ')} · send time {settings.data?.send_time}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={offsets} onChange={(e) => setOffsets(e.target.value)} placeholder="offsets, e.g. 7,4,2,1,0 (empty = default)"
              className="flex-1" />
            <label className="flex items-center gap-1.5 text-sm">
              <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              active
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {channels.data?.channels.map((ch) => (
              <label key={ch.id} className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-sm">
                <Checkbox
                  defaultChecked={c.prefs?.channel_ids.includes(ch.id) ?? false}
                  onCheckedChange={(v) => {
                    const cur = new Set(c.prefs?.channel_ids ?? [])
                    if (v === true) cur.add(ch.id)
                    else cur.delete(ch.id)
                    savePrefs.mutate({ channel_ids: [...cur] })
                  }}
                />
                {ch.name} ({ch.type})
              </label>
            ))}
          </div>
          <Button
            className="mt-3"
            onClick={() => savePrefs.mutate({
              offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [],
              enabled,
            })}
          >
            Save preferences
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
