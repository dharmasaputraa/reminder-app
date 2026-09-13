import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Channel } from '../lib/api'

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
  const [testResult, setTestResult] = useState<Record<number, string>>({})

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
    mutationFn: async (id: number) => {
      try { await api(`/channels/${id}/test`, { method: 'POST' }); return 'OK ✅' }
      catch (e) { return `GAGAL: ${String(e)}` }
    },
    onSuccess: (msg, id) => {
      setTestResult((prev) => ({ ...prev, [id]: msg }))
      setTimeout(() => setTestResult((prev) => ({ ...prev, [id]: '' })), 8000)
    },
  })

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Channel Notifikasi</h1>

      {q.data?.channels.map((ch) => (
        <div key={ch.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className={`h-2 w-2 rounded-full ${ch.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{ch.name} <span className="text-xs uppercase text-slate-400">{ch.type}</span></p>
            {testResult[ch.id] && <p className="text-sm text-slate-600">Tes: {testResult[ch.id]}</p>}
          </div>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={ch.enabled}
              onChange={(e) => toggle.mutate({ id: ch.id, enabled: e.target.checked })} /> aktif
          </label>
          <button onClick={() => test.mutate(ch.id)} disabled={test.isPending}
            className="rounded-lg border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50">Tes</button>
          <button onClick={() => { if (confirm(`Hapus channel ${ch.name}?`)) del.mutate(ch.id) }}
            className="text-sm text-red-600 hover:underline">hapus</button>
        </div>
      ))}

      <form className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"
        onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <h2 className="font-semibold">Tambah Channel</h2>
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setCfg({}) }}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {TIPE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama (mis. gotify-rumah)"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        {FIELDS[type].map((f) => (
          <input key={f.key} type={f.type ?? 'text'} required
            value={cfg[f.key] ?? ''}
            onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
            placeholder={f.label}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        ))}
        <button disabled={!name.trim() || create.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">Simpan</button>
        <p className="text-xs text-slate-400">Config disimpan terenkripsi (AES-256-GCM) — tidak bisa dilihat lagi setelah disimpan.</p>
      </form>
    </div>
  )
}
