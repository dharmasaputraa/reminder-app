import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Channel, type Contact, type Settings } from '@/lib/api'
import { defaultSummary, hydratePrefsForm, invalidateContactReminders, parseList } from '@/lib/prefs'
import { ChannelChip } from '@/components/channel-chip'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

/** The contact-level reminder defaults: per-stream offsets, active switch,
 *  channels. Same mutations and save semantics as the original card — only
 *  the layout moved to Field primitives. Channel chips save immediately;
 *  offsets + active save via the footer button (non-lossy offsets spread). */
export function ReminderPrefsTab({
  contact,
  channels,
  settings,
}: {
  contact: Contact
  channels: Channel[]
  settings?: Settings
}) {
  const qc = useQueryClient()
  const [yearly, setYearly] = useState('')
  const [monthly, setMonthly] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const form = hydratePrefsForm(contact.prefs)
    setYearly(form.yearly)
    setMonthly(form.monthly)
    setEnabled(form.enabled)
  }, [contact.prefs])

  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/contacts/${contact.id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateContactReminders(qc, contact.id)
    },
    onError: (e) => toast.error(`Failed to save preferences: ${String(e)}`),
  })

  return (
    // The tab's own card: titled header, form body below.
    <Card className="gap-0 py-0">
      <div className="flex h-11 shrink-0 items-center border-b px-4">
        <CardTitle className="text-sm font-semibold">Reminder Preferences</CardTitle>
      </div>
      <CardContent className="space-y-4 p-4">
        <p className="text-muted-foreground text-sm">
          Global defaults — {defaultSummary(settings)} · send time {settings?.send_time}
        </p>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
          <Field>
            <FieldLabel htmlFor="pref-yearly-offsets">Yearly offsets</FieldLabel>
            <Input
              id="pref-yearly-offsets"
              value={yearly}
              onChange={(e) => setYearly(e.target.value)}
              placeholder="e.g. 30, 7, 0"
              className="w-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pref-monthly-offsets">Monthly offsets</FieldLabel>
            <Input
              id="pref-monthly-offsets"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="e.g. 1, 0"
              className="w-full"
            />
          </Field>
        </div>
        <FieldDescription>Days before the occasion. Empty uses the global default for that stream.</FieldDescription>
        <Separator />
        {/* Switch-in-frame row: label + description left, control right. */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="pref-active">Active</FieldLabel>
            <FieldDescription>Paused contacts get no notifications at all.</FieldDescription>
          </FieldContent>
          <Switch
            id="pref-active"
            checked={enabled}
            onCheckedChange={(v) => setEnabled(v === true)}
          />
        </Field>
        <Separator />
        <Field>
          <FieldTitle>Channels</FieldTitle>
          <div className="flex flex-wrap gap-2">
            {channels.map((ch) => {
              const checked = contact.prefs?.channel_ids.includes(ch.id) ?? false
              return (
                <ChannelChip
                  key={ch.id}
                  channel={ch}
                  checked={checked}
                  onToggle={() => {
                    const cur = new Set(contact.prefs?.channel_ids ?? [])
                    if (checked) cur.delete(ch.id)
                    else cur.add(ch.id)
                    savePrefs.mutate({ channel_ids: [...cur] })
                  }}
                />
              )
            })}
          </div>
          <FieldDescription>
            Changes save automatically — no selection uses the system default channels.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button
          onClick={() =>
            savePrefs.mutate({
              // Non-lossy: only the two edited lists change, any other stream
              // the contact has an override for is preserved.
              offsets: { ...(contact.prefs?.offsets ?? {}), yearly: parseList(yearly), monthly: parseList(monthly) },
              enabled,
            })
          }
        >
          Save preferences
        </Button>
      </div>
      </CardContent>
    </Card>
  )
}
