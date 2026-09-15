import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Minimize2Icon, Trash2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { hydratePrefsForm } from '@/lib/prefs'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { PanelSection } from '@/components/panel-section'
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

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (occasion rows). */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

interface ContactEditFormProps {
  /** Numeric contact id (edit), or 'new' (create). */
  contactId: number | 'new'
  /** panel = docked side section (the edit panel and the ?c=new create
   *  panel); page = the /new route (create only); dialog = below-lg edit
   *  dialog body (edit only — the Dialog owns the title bar). */
  variant: 'panel' | 'page' | 'dialog'
  /** panel only: the X button in the title bar. */
  onClose?: () => void
  /** Called after a successful identity save of an EXISTING contact — the
   *  host closes the panel/dialog. Create navigates to the detail page
   *  instead (see saveIdentity.onSuccess). */
  onSaved?: () => void
}

/** The one edit/create surface: identity + occasions + preferences, moved
 *  verbatim from the old fullscreen editor. Save model is unchanged —
 *  identity via the Save/Create button, occasions add/delete immediate,
 *  preferences via "Save preferences", channels autosave. */
export function ContactEditForm({ contactId, variant, onClose, onSaved }: ContactEditFormProps) {
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

  // --- identity form ---
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

  // --- occasions + preferences form state (edit mode only) ---
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
        // Flow (unchanged): after create, land on the fullscreen detail page.
        // Replace so no `new` URL stays in history.
        nav({ to: '/reminder/contacts/$id', params: { id: String(savedId) }, replace: true })
        toast.success('Contact created')
        qc.invalidateQueries({ queryKey: ['contact', String(savedId)] })
      } else if (!isNew) {
        toast.success('Contact updated')
        // The read-only column showing beside/behind this form must drop the
        // stale name/notes — invalidate everything identity touches.
        invalidate()
        onSaved?.()
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

  // --- shared error / loading bodies (edit mode) ---
  const errorBlock = !isNew && contact.isError && (
    <div className="space-y-2">
      <p className="font-medium">
        {contact.error instanceof ApiError && contact.error.status === 404
          ? 'Contact not found'
          : 'Failed to load contact'}
      </p>
      {!(contact.error instanceof ApiError && contact.error.status === 404) && (
        <p className="text-sm text-red-600">{String(contact.error)}</p>
      )}
    </div>
  )
  const loadingBlock = !isNew && contact.isLoading && (
    <div className="space-y-2.5">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )

  // --- shared field pieces; the panel stacks them, page/dialog go 2-col ---
  const nameField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-name">Name</Label>
      <Input
        id="contact-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. Made Wijaya)"
      />
    </div>
  )
  const nicknameField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-nickname">Nickname</Label>
      <Input
        id="contact-nickname"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder="optional"
      />
    </div>
  )
  const notesField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-notes">Notes</Label>
      <Textarea
        id="contact-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="optional"
        rows={3}
      />
    </div>
  )

  const c = isNew ? undefined : contact.data
  // One occasion per type: types the contact already has are disabled in the
  // type select and the Add button locks.
  const existingTypes = new Set(c?.occasions.map((o) => o.type))
  const typeItems = TIPE.map((t) => ({
    label: t.label,
    value: t.value,
    disabled: existingTypes.has(t.value),
  }))

  const sectionPad = variant === 'dialog' ? 'pt-4' : undefined

  const occasionsSection = c && (
    <PanelSection title="Occasions" className={sectionPad}>
      {c.occasions.length === 0 && (
        <p className="text-muted-foreground">No occasions yet — add the first one below.</p>
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
      {/* flex-wrap: at 360px panel width the two w-56 controls share the row
          only when there is room and stack otherwise. */}
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
    </PanelSection>
  )

  const prefsSection = c && (
    <PanelSection title="Preferences" className={sectionPad}>
      <p className="text-muted-foreground">
        Global default: {(settings.data?.default_offsets ?? []).map((n) => `D-${n}`).join(', ')} · send time {settings.data?.send_time}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="pref-offsets">Custom offsets</Label>
        <Input
          id="pref-offsets"
          value={offsets}
          onChange={(e) => setOffsets(e.target.value)}
          placeholder="e.g. 7, 4, 2, 1, 0"
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
    </PanelSection>
  )

  // ============ PANEL: docked anatomy — h-11 title bar with the close
  // action, scrollable body, pinned Save/Create footer. ============
  if (variant === 'panel') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">{isNew ? 'New Contact' : 'Edit Contact'}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errorBlock ? (
            <div className="px-4 py-4">{errorBlock}</div>
          ) : loadingBlock ? (
            <div className="px-4 py-4">{loadingBlock}</div>
          ) : isNew ? (
            <div className="px-4 py-4">
              <p className="text-muted-foreground mb-3 text-sm">
                Occasions and preferences can be added on the detail page after saving.
              </p>
              <div className="space-y-3">
                {nameField}
                {nicknameField}
                {notesField}
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-4">
                <div className="space-y-3">
                  {nameField}
                  {nicknameField}
                  {notesField}
                </div>
              </div>
              {occasionsSection}
              {prefsSection}
            </>
          )}
        </div>
        <div className="border-t p-3">
          <Button
            className="w-full"
            disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
            onClick={() => saveIdentity.mutate()}
          >
            {isNew ? 'Create contact' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  // ============ PAGE (/new, create only): identity header + Card — the old
  // fullscreen create's composition. ============
  if (variant === 'page') {
    return (
      <div className="space-y-5">
        <div className="relative">
          <div className="absolute end-0 top-0 flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back to list"
              onClick={() => nav({ to: '/reminder/contacts', replace: true })}
            >
              <Minimize2Icon aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">
                <UserPlusIcon aria-hidden="true" className="size-6" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <h1 className="text-pretty text-lg leading-snug font-semibold">New contact</h1>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground -mt-2 text-center text-sm">
          Occasions and preferences can be added on the detail page after saving.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {nameField}
              {nicknameField}
            </div>
            {notesField}
            <div className="flex justify-end">
              <Button
                disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
                onClick={() => saveIdentity.mutate()}
              >
                Create contact
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============ DIALOG: no own title bar (the Dialog supplies it), sections
  // without horizontal padding (DialogContent pads), Save in a footer row. ============
  return (
    <div className="text-sm">
      <div className="max-h-[60vh] min-h-0 space-y-4 overflow-y-auto">
        {errorBlock ? (
          errorBlock
        ) : loadingBlock ? (
          loadingBlock
        ) : (
          <>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {nameField}
                {nicknameField}
              </div>
              {notesField}
            </div>
            {occasionsSection}
            {prefsSection}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
          onClick={() => saveIdentity.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
