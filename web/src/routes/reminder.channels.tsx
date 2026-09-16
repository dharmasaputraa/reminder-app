import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, type Channel, type Settings } from '../lib/api'
import { pageTitle } from '../lib/page-title'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/reminder/channels')({
  component: Channels,
  head: () => ({ meta: [{ title: pageTitle('Channels') }] }),
})

const TIPE = ['gotify', 'telegram', 'email'] as const

const FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  gotify: [
    { key: 'base_url', label: 'Gotify Base URL' },
    { key: 'token', label: 'App Token' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token (from @BotFather)' },
    { key: 'chat_id', label: 'Chat ID (user/group)' },
  ],
  email: [
    { key: 'host', label: 'SMTP Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'from', label: 'Sender address' },
    { key: 'to', label: 'To (comma-separated)' },
  ],
}

function Channels() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const [type, setType] = useState<(typeof TIPE)[number]>('gotify')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<Record<string, string | number>>({})

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })

  // Toggling a channel's "Default" saves immediately — same inline-edit model
  // as the card's active switch. The default channels receive the reminders of
  // contacts without their own selection.
  const setDefault = useMutation({
    mutationFn: (ids: string[]) =>
      api('/settings', { method: 'PUT', body: JSON.stringify({ ...settings.data, default_channel_ids: ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => toast.error(`Failed to save default channel: ${String(e)}`),
  })
  const isDefault = (id: string) => (settings.data?.default_channel_ids ?? []).includes(id)
  const toggleDefault = (id: string, on: boolean) => {
    const cur = new Set(settings.data?.default_channel_ids ?? [])
    if (on) cur.add(id)
    else cur.delete(id)
    setDefault.mutate([...cur])
  }
  const create = useMutation({
    mutationFn: () => api('/channels', { method: 'POST', body: JSON.stringify({ type, name, config: cfg }) }),
    onSuccess: () => { setName(''); setCfg({}); invalidate() },
  })
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      api(`/channels/${v.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v.enabled }) }),
    onSuccess: invalidate,
  })
  const del = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
  const test = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/test`, { method: 'POST' }),
    onSuccess: () => toast.success('Test succeeded — notification sent.'),
    onError: (e) => toast.error(`Test failed: ${String(e)}`),
  })

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Notification Channels</h1>
      <p className="text-sm text-muted-foreground">
        Contacts without their own channel selection use the default ones. No default — every enabled channel is used.
      </p>

      {q.data?.channels.map((ch) => (
        <Card key={ch.id} className="flex flex-row items-center gap-3 p-3">
          <Badge variant={ch.enabled ? 'default' : 'secondary'}>{ch.type}</Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ch.name}</p>
            <p className="text-xs text-muted-foreground">{ch.enabled ? 'active' : 'inactive'}</p>
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={isDefault(ch.id)}
              disabled={!settings.data || setDefault.isPending}
              onCheckedChange={(v) => toggleDefault(ch.id, v === true)}
            />
            Default
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <Switch
              checked={ch.enabled}
              onCheckedChange={(v) => toggle.mutate({ id: ch.id, enabled: v === true })}
            />
            active
          </label>
          <Button variant="outline" size="sm" onClick={() => test.mutate(ch.id)} disabled={test.isPending}>
            Test
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm">Delete</Button>}
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete channel {ch.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This channel can no longer be used to send reminders.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => del.mutate(ch.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Add Channel</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
            <div className="flex flex-wrap gap-2">
              <Select
                value={type}
                onValueChange={(v) => {
                  if (!v) return
                  setType(v as typeof type)
                  setCfg({})
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {TIPE.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. gotify-home)"
                className="flex-1"
              />
            </div>
            {FIELDS[type].map((f) => (
              <Input key={f.key} type={f.type ?? 'text'} required
                value={cfg[f.key] ?? ''}
                onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                placeholder={f.label} />
            ))}
            <Button type="submit" disabled={!name.trim() || create.isPending}>Save</Button>
            <Alert>
              <AlertTitle>Config is stored encrypted (AES-256-GCM)</AlertTitle>
              <AlertDescription>It cannot be viewed again after saving.</AlertDescription>
            </Alert>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
