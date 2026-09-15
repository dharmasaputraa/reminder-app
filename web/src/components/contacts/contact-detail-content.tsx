import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Minimize2Icon, PencilIcon, XIcon } from 'lucide-react'
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
  /** docked = read-only right section of /reminder/contacts;
   *  page = fullscreen route, the only place editing happens. */
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

  // --- identity form (create on both variants; edit only on the page) ---
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

  // --- occasions + preferences form state (page variant only) ---
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
      const savedId = 'id' in saved ? saved.id : null
      if (isNew && savedId != null) {
        // Flow (revision): after create, land on the fullscreen detail page —
        // occasions/preferences are managed there. Replace so no `new` URL
        // stays in history.
        nav({ to: '/reminder/contacts/$id', params: { id: String(savedId) }, replace: true })
        toast.success('Contact created')
        qc.invalidateQueries({ queryKey: ['contact', String(savedId)] })
      } else if (!isNew) {
        toast.success('Contact updated')
      }
      qc.invalidateQueries({ queryKey: ['contacts'] })
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
      // The grid (and next-reminder column) must drop the deleted contact.
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
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

  /** Header action shared by every variant: close (docked) collapses the
   *  panel by dropping ?c; collapse (page) returns to the docked view. */
  const backAction =
    variant === 'docked' ? (
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Close panel"
        onClick={() => nav(isNew ? { to: '/reminder/contacts', replace: true } : { to: '/reminder/contacts', search: {}, replace: true })}
      >
        <XIcon aria-hidden="true" />
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
              : { to: '/reminder/contacts', search: { c: contactId }, replace: true },
          )
        }
      >
        <Minimize2Icon aria-hidden="true" />
      </Button>
    )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {c && (
            <Avatar>
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{isNew ? 'New contact' : c?.name}</h1>
            {!isNew && c?.nickname && (
              <p className="text-muted-foreground truncate text-sm">{c.nickname}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {backAction}
          {/* Docked is read-only (revision): editing happens on the fullscreen
              detail URL. Pencil navigates there. */}
          {variant === 'docked' && !isNew && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Edit contact"
              onClick={() => nav({ to: '/reminder/contacts/$id', params: { id } })}
            >
              <PencilIcon aria-hidden="true" />
            </Button>
          )}
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" size="icon-sm" aria-label="Delete contact" />}
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
          Occasions and reminder preferences can be added on the detail page after saving.
        </p>
      )}

      {/* ============ Identity: a form for create + page edit; the docked
          panel shows read-only details instead. ============ */}
      {isNew || variant === 'page' ? (
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
      ) : (
        c && (
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Nickname</span>
                <span>{c.nickname || '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Notes</span>
                <span className="whitespace-pre-wrap">{c.notes || '—'}</span>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* ============ Occasions + preferences: managed on the page; the
          docked panel lists them read-only. ============ */}
      {isNew ? null : !c ? null : variant === 'page' ? (
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
      ) : (
        <>
          {/* Read-only occasion list — editing lives on the detail page. */}
          <Card>
            <CardHeader>
              <CardTitle>Occasions</CardTitle>
            </CardHeader>
            <CardContent>
              {c.occasions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No occasions yet — use the edit page to add one.
                </p>
              ) : (
                c.occasions.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0">
                    <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                    {longDate(o.base_date)}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reminder Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Offsets</span>
                <span>
                  {c.prefs?.offsets?.length
                    ? c.prefs.offsets.map((n) => `D-${n}`).join(', ')
                    : `Global default${settings.data ? ` (${settings.data.default_offsets.map((n) => `D-${n}`).join(', ')})` : ''}`}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Status</span>
                <span>
                  {c.prefs?.enabled === false ? (
                    <Badge variant="warning-outline">Paused</Badge>
                  ) : (
                    <Badge variant="success-outline">Active</Badge>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Channels</span>
                <span className="flex flex-wrap gap-1">
                  {(() => {
                    const chosen = (channels.data?.channels ?? []).filter((ch) => c.prefs?.channel_ids.includes(ch.id))
                    if (chosen.length === 0) return <span>—</span>
                    return chosen.map((ch) => (
                      <Badge key={ch.id} variant="secondary">{ch.name} ({ch.type})</Badge>
                    ))
                  })()}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
