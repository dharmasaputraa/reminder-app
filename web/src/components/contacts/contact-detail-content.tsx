import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRightIcon, Maximize2Icon, Trash2Icon, XIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Occasion, type Settings } from '@/lib/api'
import { initials } from '@/lib/initials'
import { hydratePrefsForm, parseList } from '@/lib/prefs'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { OccasionPrefsEditor } from '@/components/contacts/occasion-prefs-editor'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { ReminderTrigger } from '@/components/event-detail'
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

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (page occasion rows). */
function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

/** Compact variant for the narrow docked panel: "Wed, 18 Jun 2003". */
function shortDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEE, d MMM yyyy')
}

/** "[30, 7, 0]" → "D-30, D-7, on the day" — the copy form for offset lists. */
function offsetsSummary(list?: number[]): string {
  return (list ?? []).map((n) => (n === 0 ? 'on the day' : `D-${n}`)).join(', ')
}

/** The per-recurrence default sets the contact form edits, as copy:
 *  "Yearly: D-30, D-7, … · Monthly: on the day". */
function defaultSummary(settings?: Settings): string {
  return (
    `Yearly: ${offsetsSummary(settings?.recurrence_offsets?.yearly)} · ` +
    `Monthly: ${offsetsSummary(settings?.recurrence_offsets?.monthly)}`
  )
}

interface ContactDetailContentProps {
  contactId: string
  /** docked = read-only right section of /reminder/contacts;
   *  page = the editable sections column of /reminder/contacts/$id —
   *  occasions/preferences are edited in place; identity + actions live
   *  in the sticky ContactSummaryCard beside this column. */
  variant: 'docked' | 'page'
}

export function ContactDetailContent({ contactId, variant }: ContactDetailContentProps) {
  const id = contactId
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  // Countdown per occasion (next occurrence inside the 400-day window) —
  // shares the grid's ['upcoming','grid'] query, no extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  // --- occasions + preferences form state (page variant only) ---
  const [type, setType] = useState('otonan') // built-in value or 'custom'
  const [customType, setCustomType] = useState('') // free text when type === 'custom'
  const [recurrence, setRecurrence] = useState<Occasion['recurrence']>('yearly')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')
  const [yearly, setYearly] = useState('')
  const [monthly, setMonthly] = useState('')
  const [enabled, setEnabled] = useState(true)

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

  useEffect(() => {
    if (!contact.data) return
    const form = hydratePrefsForm(contact.data.prefs)
    setYearly(form.yearly)
    setMonthly(form.monthly)
    setEnabled(form.enabled)
  }, [contact.data])

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
    // Prefix match also refreshes ['upcoming', 'grid'] (next-reminder column)
    // and the dashboard's ['upcoming', days] / ['upcoming-year', y] queries.
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }

  const addOcc = useMutation({
    mutationFn: () =>
      api(`/contacts/${id}/occasions`, {
        method: 'POST',
        body: JSON.stringify({ type: effectiveType, recurrence, date, label: label.trim() }),
      }),
    onSuccess: () => {
      setDate('')
      setDateSel(undefined)
      setPawukon('')
      setLabel('')
      setCustomType('')
      invalidate()
    },
    onError: (e) => toast.error(`Failed to add occasion: ${String(e)}`),
  })
  const delOcc = useMutation({
    mutationFn: (oid: string) => api(`/occasions/${oid}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Failed to delete occasion: ${String(e)}`),
  })
  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/contacts/${id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Failed to save preferences: ${String(e)}`),
  })

  if (contact.isLoading)
    return variant === 'docked' ? (
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
    ) : (
      // Page: two section-card skeletons — identity has its own card now.
      <div className="space-y-5">
        <div className="rounded-xl border bg-card">
          <div className="px-4 pt-4">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-2.5 px-4 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="rounded-xl border bg-card">
          <div className="px-4 pt-4">
            <Skeleton className="h-5 w-44" />
          </div>
          <div className="space-y-2.5 px-4 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    )
  if (contact.isError) {
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
  const c = contact.data!

  /** Identity block (docked panel only): avatar above the name (+ nickname)
   *  — the centered profile header. The page variant has no identity block
   *  here; it lives in the sticky ContactSummaryCard. */
  const identityBlock = (
    <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
      <Avatar className="size-16">
        <AvatarFallback className="text-lg">{initials(c.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
        {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
      </div>
    </div>
  )

  const notesSection = c.notes ? (
    <PanelSection title="Notes">
      <p className="text-pretty whitespace-pre-wrap">{c.notes}</p>
    </PanelSection>
  ) : null

  const remindersSection = (
    <PanelSection title="Reminders">
      <DetailRow label="Status">
        {c.prefs?.enabled === false ? (
          <Badge variant="warning-outline">Paused</Badge>
        ) : (
          <Badge variant="success-outline">Active</Badge>
        )}
      </DetailRow>
      <DetailRow label="Offsets">
        {(() => {
          // Offsets are a per-stream map now; this read-only row shows the
          // union of every stream's list (the per-stream editor is Task 10).
          const offs = [...new Set(Object.values(c.prefs?.offsets ?? {}).flat())].sort((a, b) => b - a)
          if (offs.length === 0) {
            return (
              <>
                Default
                {settings.data && (
                  <span className="text-muted-foreground font-normal">
                    {' '}({defaultSummary(settings.data)})
                  </span>
                )}
              </>
            )
          }
          return (
            <span className="flex flex-wrap justify-end gap-1">
              {offs.map((n) => (
                <Badge key={n} variant="secondary">D-{n}</Badge>
              ))}
            </span>
          )
        })()}
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
  )

  // ============ DOCKED: agenda-panel anatomy — h-11 title bar with the
  // fullscreen + close actions, then read-only sections separated by
  // hairlines. Occasions cap at 3 with a see-all jump to the page. ============
  if (variant === 'docked') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">Contact</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open fullscreen detail"
              // Rendered as a real link: cmd/ctrl+click, middle-click and
              // the context menu open the fullscreen page in a new tab
              // natively (30e6655); a plain click is the Link's SPA nav.
              render={<Link to="/reminder/contacts/$id" params={{ id }} />}
            >
              <Maximize2Icon aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close panel"
              onClick={() => nav({ to: '/reminder/contacts', search: {}, replace: true })}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {identityBlock}
          {notesSection}
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
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {/* Per-occasion override: paused occasions notify nothing. */}
                            {o.prefs?.enabled === false && (
                              <Badge variant="warning-outline">Paused</Badge>
                            )}
                            {up && (
                              <Badge
                                variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                                className="shrink-0"
                              >
                                {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                              </Badge>
                            )}
                          </span>
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
          {remindersSection}
        </div>
      </div>
    )
  }

  // ============ PAGE: the editable sections column — Occasions and
  // Reminder Preferences cards. Identity + the Edit/⋮ actions live in the
  // sticky ContactSummaryCard beside this column (route-level). ============
  return (
    <div className="space-y-5 text-sm">
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
              {c.occasions.map((o) => {
                const up = upcomingByOccasion.get(o.id)
                return (
                  <div key={o.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                        <Badge variant="outline" className="capitalize">{o.recurrence}</Badge>
                        {o.prefs?.enabled === false && <Badge variant="warning-outline">Paused</Badge>}
                        <span className="truncate">
                          {longDate(o.base_date)}
                          {o.label && <span className="text-muted-foreground"> · {o.label}</span>}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {/* Remind needs an actual occurrence date: the backend
                            matches `date` exactly, and a base date is not an
                            occurrence for otonan (base+210n). */}
                        {up && (
                          <>
                            <Badge
                              variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                              className="shrink-0"
                            >
                              {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                            </Badge>
                            <ReminderTrigger
                              kind="occasion"
                              occasionId={o.id}
                              contactId={c.id}
                              date={up.date}
                              title={`${c.name}'s ${o.type}`}
                              variant="ghost"
                              compact
                              className="size-7 justify-center px-0 text-muted-foreground hover:text-foreground"
                            />
                          </>
                        )}
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
                      </span>
                    </div>
                    {/* Per-occasion overrides: PUT full-replace / DELETE inherit. */}
                    <OccasionPrefsEditor
                      contactId={c.id}
                      occasion={o}
                      channels={channels.data?.channels ?? []}
                    />
                  </div>
                )
              })}
            </div>
          )}
          {/* flex-wrap: the w-56 controls share the row only when there is
              room and stack on narrow viewports. Custom types reveal a
              free-text input in place, with the previously used types as
              clickable suggestion chips underneath. */}
          <div className="mt-4 space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                items={TYPE_ITEMS}
                value={type}
                onValueChange={(v) => {
                  if (!v) return
                  // "Custom…" falls back to yearly while the recurrence is
                  // still the previous type's default — a manual pick is kept.
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reminder Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Global defaults — {defaultSummary(settings.data)} · send time {settings.data?.send_time}
          </p>
          {/* Offsets are a per-stream map; the minimal contact form edits the
              yearly + monthly lists and leaves other streams untouched. */}
          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="pref-yearly-offsets">Yearly offsets</Label>
              <Input
                id="pref-yearly-offsets"
                value={yearly}
                onChange={(e) => setYearly(e.target.value)}
                placeholder="e.g. 30, 7, 0"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pref-monthly-offsets">Monthly offsets</Label>
              <Input
                id="pref-monthly-offsets"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="e.g. 1, 0"
                className="w-full"
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Days before the occasion. Empty uses the global default for that stream.
          </p>
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
                // Non-lossy: only the two edited lists change, any other
                // stream the contact has an override for is preserved.
                offsets: { ...(c.prefs?.offsets ?? {}), yearly: parseList(yearly), monthly: parseList(monthly) },
                enabled,
              })}
            >
              Save preferences
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
