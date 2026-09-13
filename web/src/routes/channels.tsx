import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, type Channel } from '../lib/api'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/channels')({ component: Channels })

const TIPE = ['gotify', 'telegram', 'email'] as const

const FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  gotify: [
    { key: 'base_url', label: 'Base URL Gotify' },
    { key: 'token', label: 'Token App' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token (dari @BotFather)' },
    { key: 'chat_id', label: 'Chat ID (user/grup)' },
  ],
  email: [
    { key: 'host', label: 'SMTP Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'from', label: 'Alamat pengirim' },
    { key: 'to', label: 'Kepada (pisah koma)' },
  ],
}

function Channels() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const [type, setType] = useState<(typeof TIPE)[number]>('gotify')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<Record<string, string | number>>({})

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })
  const create = useMutation({
    mutationFn: () => api('/channels', { method: 'POST', body: JSON.stringify({ type, name, config: cfg }) }),
    onSuccess: () => { setName(''); setCfg({}); invalidate() },
  })
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) =>
      api(`/channels/${v.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v.enabled }) }),
    onSuccess: invalidate,
  })
  const del = useMutation({
    mutationFn: (id: number) => api(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
  const test = useMutation({
    mutationFn: (id: number) => api(`/channels/${id}/test`, { method: 'POST' }),
    onSuccess: () => toast.success('Tes berhasil — notifikasi terkirim.'),
    onError: (e) => toast.error(`Tes gagal: ${String(e)}`),
  })

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Channel Notifikasi</h1>

      {q.data?.channels.map((ch) => (
        <Card key={ch.id} className="flex flex-row items-center gap-3 p-3">
          <Badge variant={ch.enabled ? 'default' : 'secondary'}>{ch.type}</Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ch.name}</p>
            <p className="text-xs text-slate-400">{ch.enabled ? 'aktif' : 'nonaktif'}</p>
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <Switch
              checked={ch.enabled}
              onCheckedChange={(v) => toggle.mutate({ id: ch.id, enabled: v === true })}
            />
            aktif
          </label>
          <Button variant="outline" size="sm" onClick={() => test.mutate(ch.id)} disabled={test.isPending}>
            Tes
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm">Hapus</Button>}
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus channel {ch.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Channel tidak bisa dipakai lagi untuk mengirim pengingat.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={() => del.mutate(ch.id)}>Hapus</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Tambah Channel</CardTitle>
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
                  <SelectValue placeholder="Pilih tipe" />
                </SelectTrigger>
                <SelectContent>
                  {TIPE.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama (mis. gotify-rumah)"
                className="flex-1"
              />
            </div>
            {FIELDS[type].map((f) => (
              <Input key={f.key} type={f.type ?? 'text'} required
                value={cfg[f.key] ?? ''}
                onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                placeholder={f.label} />
            ))}
            <Button type="submit" disabled={!name.trim() || create.isPending}>Simpan</Button>
            <Alert>
              <AlertTitle>Config disimpan terenkripsi (AES-256-GCM)</AlertTitle>
              <AlertDescription>Tidak bisa dilihat lagi setelah disimpan.</AlertDescription>
            </Alert>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
