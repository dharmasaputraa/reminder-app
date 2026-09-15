import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { hydratePrefsForm } from '@/lib/prefs'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { DetailRow, PanelSection } from '@/components/panel-section'
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

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (editor rows). */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

/** Compact variant for the narrow docked panel: "Wed, 18 Jun 2003". */
function shortDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEE, d MMM yyyy')
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
  // Countdown per occasion (next occurrence inside the 400-day window) —
  // shares the grid's ['upcoming','grid'] query, no extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

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
      nav({ to: '/reminder/contacts', replace: true })
    },
    onError: (e) => toast.error(`Failed to delete contact: ${String(e)}`),
  })

  if (!isNew && contact.isLoading)
    return (
      <div>
        <div className="flex flex-col items-center gap-2 px-4 pt-8">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-6 space-y-2.5 border-t px-4 py-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  if (!isNew && contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2 p-4">
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

  /** Identity block: avatar above the name (+ nickname) — the panel's subject,
   *  centered like a profile header. New contacts get a placeholder avatar so
   *  the composition holds before anything is typed. */
  const identityBlock = (
    <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
      <Avatar className="size-16">
        <AvatarFallback className="text-lg">
          {isNew ? <UserPlusIcon aria-hidden="true" className="size-6" /> : initials(c!.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <h1 className="text-pretty text-lg leading-snug font-semibold">
          {isNew ? 'New contact' : c?.name}
        </h1>
        {!isNew && c?.nickname && (
          <p className="text-muted-foreground text-sm">{c.nickname}</p>
        )}
      </div>
    </div>
  )

  const deleteDialog = !isNew && (
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
  )

  // ============ DOCKED: agenda-panel anatomy — h-11 title bar with the
  // fullscreen + close actions, centered identity block, then read-only
  // sections separated by hairlines (no nested cards inside the panel card).
  // ============
  if (variant === 'docked') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">{isNew ? 'New Contact' : 'Contact'}</span>
          <div className="flex items-center gap-1">
            {!isNew && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open fullscreen detail"
                onClick={() => nav({ to: '/reminder/contacts/$id', params: { id } })}
              >
                <Maximize2Icon aria-hidden="true" className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close panel"
              onClick={() => nav(isNew ? { to: '/reminder/contacts', replace: true } : { to: '/reminder/contacts', search: {}, replace: true })}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {identityBlock}
          {isNew ? (
            <div className="border-t px-4 py-4">
              <p className="text-muted-foreground mb-3 text-sm">
                Occasions and preferences can be added on the detail page after saving.
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="docked-contact-name">Name</Label>
                  <Input
                    id="docked-contact-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name (e.g. Made Wijaya)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="docked-contact-nickname">Nickname</Label>
                  <Input
                    id="docked-contact-nickname"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="docked-contact-notes">Notes</Label>
                  <Textarea
                    id="docked-contact-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="optional"
                    rows={3}
                  />
                </div>
              </div>
            </div>
          ) : (
            c && (
              <>
                {c.notes && (
                  <PanelSection title="Notes">
                    <p className="text-pretty whitespace-pre-wrap">{c.notes}</p>
                  </PanelSection>
                )}

                <PanelSection title="Occasions">
                  {c.occasions.length === 0 ? (
                    <p className="text-muted-foreground">
                      No occasions yet — open the fullscreen detail to add one.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {c.occasions.slice(0, 3).map((o) => {
                          const up = upcomingByOccasion.get(o.id)
                          return (
                            <div key={o.id} className="rounded-lg bg-muted/60 px-3 py-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-muted-foreground text-xs font-medium capitalize">
                                    {o.type}
                                  </p>
                                  <p className="mt-0.5 text-sm font-medium tabular-nums">{shortDate(o.base_date)}</p>
                                </div>
                                {up && (
                                  <Badge
                                    variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                                    className="shrink-0"
                                  >
                                    {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {c.occasions.length > 3 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mx-auto flex"
                          onClick={() => nav({ to: '/reminder/contacts/$id', params: { id } })}
                        >
                          See all {c.occasions.length} occasions
                          <ChevronRightIcon aria-hidden="true" />
                        </Button>
                      )}
                    </>
                  )}
                </PanelSection>

                <PanelSection title="Reminders">
                  <DetailRow label="Status">
                    {c.prefs?.enabled === false ? (
                      <Badge variant="warning-outline">Paused</Badge>
                    ) : (
                      <Badge variant="success-outline">Active</Badge>
                    )}
                  </DetailRow>
                  <DetailRow label="Offsets">
                    {c.prefs?.offsets?.length ? (
                      <span className="flex flex-wrap justify-end gap-1">
                        {[...c.prefs.offsets].sort((a, b) => b - a).map((n, i) => (
                          <Badge key={`${n}-${i}`} variant="secondary">D-{n}</Badge>
                        ))}
                      </span>
                    ) : (
                      <>
                        Default
                        {settings.data && (
                          <span className="text-muted-foreground font-normal">
                            {' '}({settings.data.default_offsets.map((n) => `D-${n}`).join(', ')})
                          </span>
                        )}
                      </>
                    )}
                  </DetailRow>
                  <DetailRow label="Channels">
                    {(() => {
                      const chosen = (channels.data?.channels ?? []).filter((ch) => c.prefs?.channel_ids.includes(ch.id))
                      if (chosen.length === 0) {
                        // No own selection → the system default channels apply.
                        const defaults = (channels.data?.channels ?? []).filter((ch) =>
                          (settings.data?.default_channel_ids ?? []).includes(ch.id))
                        return (
                          <>
                            Default
                            <span className="text-muted-foreground font-normal">
                              {' '}({defaults.map((d) => d.name).join(', ') || 'all channels'})
                            </span>
                          </>
                        )
                      }
                      return (
                        <span className="flex flex-wrap justify-end gap-1">
                          {chosen.map((ch) => (
                            <Badge key={ch.id} variant="secondary">{ch.name} ({ch.type})</Badge>
                          ))}
                        </span>
                      )
                    })()}
                  </DetailRow>
                </PanelSection>
              </>
            )
          )}
        </div>
        {/* Pinned action footer — the agenda detail's Remind Now slot. The
            read-only panel carries no delete: that lives on the fullscreen
            editor page. */}
        {isNew && (
          <div className="border-t p-3">
            <Button
              className="w-full"
              disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
              onClick={() => saveIdentity.mutate()}
            >
              Create contact
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ============ PAGE (fullscreen): the editor. Centered identity with the
  // actions pinned to the top-right corner; no minimize after create — back
  // is the browser's job once the panel was closed. ============
  return (
    <div className="space-y-5">
      <div className="relative">
        <div className="absolute end-0 top-0 flex items-center gap-1.5">
          {isNew && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back to list"
              onClick={() => nav({ to: '/reminder/contacts', replace: true })}
            >
              <Minimize2Icon aria-hidden="true" />
            </Button>
          )}
          {deleteDialog}
        </div>
        {identityBlock}
      </div>

      {isNew && (
        <p className="text-muted-foreground -mt-2 text-center text-sm">
          Occasions and preferences can be added on this page after saving.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isNew ? 'Identity' : 'Details'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="page-contact-name">Name</Label>
              <Input
                id="page-contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Made Wijaya)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="page-contact-nickname">Nickname</Label>
              <Input
                id="page-contact-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="page-contact-notes">Notes</Label>
            <Textarea
              id="page-contact-notes"
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
              {c.occasions.length === 0 && (
                <p className="text-muted-foreground text-sm">No occasions yet — add the first one below.</p>
              )}
              {c.occasions.length > 0 && (
                <div className="divide-y">
                  {c.occasions.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                        <span className="truncate">{longDate(o.base_date)}</span>
                      </span>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${o.type} occasion`}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {o.type} on {longDate(o.base_date)} will be permanently deleted.
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
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
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
                <p className="text-muted-foreground mt-3 text-xs">
                  This contact already has this type of occasion — only one of each type is allowed.
                </p>
              )}
              {pawukon && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
              {type === 'birthday' && date.endsWith('-02-29') && (
                <p className="text-muted-foreground mt-3 text-xs">Feb 29 in non-leap years is observed on March 1.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reminder Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Global default: {(settings.data?.default_offsets ?? []).map((n) => `D-${n}`).join(', ')} · send time {settings.data?.send_time}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="pref-offsets">Custom offsets</Label>
                <Input
                  id="pref-offsets"
                  value={offsets}
                  onChange={(e) => setOffsets(e.target.value)}
                  placeholder="e.g. 7, 4, 2, 1, 0"
                  className="w-full sm:max-w-xs"
                />
                <p className="text-muted-foreground text-xs">
                  Days before the occasion. Empty uses the global default.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
                Active
              </label>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Channels</div>
                <div className="flex flex-wrap gap-2">
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
                <p className="text-muted-foreground text-xs">
                  Changes save automatically — no selection uses the system default channels.
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => savePrefs.mutate({
                    offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [],
                    enabled,
                  })}
                >
                  Save preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
