import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Maximize2Icon, Minimize2Icon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { hydratePrefsForm } from '@/lib/prefs'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const TIPE: { value: string; label: string }[] = [
  { value: 'otonan', label: 'Otonan (210-day Pawukon)' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
]

/** ISO yyyy-MM-dd → "18/06/2003 (Wednesday, 18 June 2003)". */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'dd/MM/yyyy (EEEE, d MMMM yyyy)')
}

interface ContactDetailContentProps {
  /** Numeric contact id, or 'new' for the create form. */
  contactId: number | 'new'
  /** docked = right section of /reminder/contacts; page = fullscreen route. */
  variant: 'docked' | 'page'
}

export function ContactDetailContent({ contactId, variant }: ContactDetailContentProps) {
  const isNew = contactId === 'new'
  const id = String(contactId)
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
    enabled: !isNew,
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  // --- identity form (new capability; dirty-gated explicit save) ---
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!contact.data) return
    setName(contact.data.name)
    setNickname(contact.data.nickname)
    setNotes(contact.data.notes)
  }, [contact.data])

  const identityDirty = !contact.data
    ? name.trim() !== '' // create: ready as soon as there is a name
    : name !== contact.data.name || nickname !== contact.data.nickname || notes !== contact.data.notes

  // --- occasions + preferences form state (moved from the detail page) ---
  const [type, setType] = useState('otonan')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')
  const [offsets, setOffsets] = useState('')
  const [enabled, setEnabled] = useState(true)

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
    // Prefix match also refreshes ['upcoming', 'grid'] (next-reminder column)
    // and the dashboard's ['upcoming', days] / ['upcoming-year', y] queries.
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }

  const saveIdentity = useMutation({
    // Create returns the created contact; PATCH only returns {ok:true}.
    mutationFn: (): Promise<Contact | { ok: boolean }> => {
      const body = JSON.stringify({ name: name.trim(), nickname: nickname.trim(), notes })
      return isNew
        ? api<Contact>('/contacts', { method: 'POST', body })
        : api<{ ok: boolean }>(`/contacts/${id}`, { method: 'PATCH', body })
    },
    onSuccess: (saved) => {
      const savedId = 'id' in saved ? String(saved.id) : id
      if (isNew) {
        // Spec: after create, replace so no `new` URL stays in history.
        if (variant === 'docked')
          nav({ to: '/reminder/contacts', search: { c: savedId }, replace: true })
        else nav({ to: '/reminder/contacts/$id', params: { id: savedId }, replace: true })
        toast.success('Contact created')
      } else {
        toast.success('Contact updated')
      }
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact', savedId] })
    },
    onError: (e) => toast.error(`Failed to save contact: ${String(e)}`),
  })

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
    onSuccess: () => {
      toast.success('Contact deleted')
      // Spec: docked drops ?c (replace); fullscreen goes back to the list.
      if (variant === 'docked') nav({ to: '/reminder/contacts', search: {}, replace: true })
      else nav({ to: '/reminder/contacts', replace: true })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  if (!isNew && contact.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  if (!isNew && contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2">
        <p className="font-medium">{notFound ? 'Contact not found' : 'Failed to load contact'}</p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
        <Button variant="outline" size="sm" onClick={() => nav({ to: '/reminder/contacts' })}>
          Back to contacts
        </Button>
      </div>
    )
  }
  const c = isNew ? undefined : contact.data!

  // One occasion per type: types the contact already has are disabled in the
  // type select and the Add button locks (moved logic, unchanged).
  const existingTypes = new Set(c?.occasions.map((o) => o.type))
  const typeItems = TIPE.map((t) => ({
    label: t.label,
    value: t.value,
    disabled: existingTypes.has(t.value),
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {c && (
            <Avatar>
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
          )}
          <h1 className="truncate text-xl font-bold">{isNew ? 'New contact' : c?.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Expand (docked → fullscreen, push) / Collapse (fullscreen →
              docked, replace) — history contract in the spec. */}
          {variant === 'docked' ? (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Expand to fullscreen"
              onClick={() =>
                nav(isNew ? { to: '/reminder/contacts/new' } : { to: '/reminder/contacts/$id', params: { id } })
              }
            >
              <Maximize2Icon aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back to list"
              onClick={() =>
                nav(
                  isNew
                    ? { to: '/reminder/contacts', replace: true }
                    : { to: '/reminder/contacts', search: { c: id }, replace: true },
                )
              }
            >
              <Minimize2Icon aria-hidden="true" />
            </Button>
          )}
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm">Delete contact</Button>}
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {c?.name}?</AlertDialogTitle>
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
          )}
        </div>
      </div>

      {isNew && (
        <p className="text-sm text-muted-foreground">
          Occasions and reminder preferences can be added after saving.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isNew ? 'Identity' : 'Details'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${variant}-contact-name`}>Name</Label>
              <Input
                id={`${variant}-contact-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Made Wijaya)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${variant}-contact-nickname`}>Nickname</Label>
              <Input
                id={`${variant}-contact-nickname`}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${variant}-contact-notes`}>Notes</Label>
            <Textarea
              id={`${variant}-contact-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
              onClick={() => saveIdentity.mutate()}
            >
              {isNew ? 'Create contact' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isNew && c && (
        <>
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
                        <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
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
        </>
      )}
    </div>
  )
}
