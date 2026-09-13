import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, type Settings } from '../lib/api'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

const KATEGORI = [
  { key: 'pawukon', label: 'Hari raya Pawukon (dihitung lokal)' },
  { key: 'saka', label: 'Hari raya Bali & Saka (API)' },
  { key: 'national', label: 'Libur nasional (API)' },
]

function SettingsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const [form, setForm] = useState<Settings | null>(null)

  useEffect(() => { if (q.data && !form) setForm(q.data) }, [q.data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api('/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  if (!form) return <p className="text-slate-500">Memuat…</p>
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Pengaturan</h1>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          Timezone
          <input value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}
            placeholder="Asia/Jakarta / Asia/Makassar"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">
          Jam kirim (HH:MM)
          <input value={form.send_time} onChange={(e) => set({ send_time: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">
          Catch-up window (jam) — pengingat yang terlewat karena perangkat mati
          <input type="number" value={form.catch_up_hours}
            onChange={(e) => set({ catch_up_hours: Number(e.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">
          Offset default (hari sebelum H, pisah koma)
          <input value={form.default_offsets.join(',')}
            onChange={(e) => set({ default_offsets: e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Kategori hari raya</legend>
          {KATEGORI.map((k) => (
            <label key={k.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.holiday_categories[k.key] ?? false}
                onChange={(e) => set({ holiday_categories: { ...form.holiday_categories, [k.key]: e.target.checked } })} />
              {k.label}
            </label>
          ))}
        </fieldset>
        <button onClick={() => save.mutate(form)} disabled={save.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
          Simpan
        </button>
        {save.isError && <p className="text-sm text-red-600">{String(save.error)}</p>}
        {save.isSuccess && <p className="text-sm text-emerald-600">Tersimpan.</p>}
      </div>

      {me.data && (
        <p className="text-sm text-slate-500">
          Masuk sebagai <b>{me.data.email}</b> ({me.data.role}) — mode dev via header X-Dev-Email;
          produksi via Cloudflare Access.
        </p>
      )}
    </div>
  )
}
