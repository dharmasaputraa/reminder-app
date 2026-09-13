import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, type Channel, type Contact, type Settings } from '../lib/api'
import { hydratePrefsForm } from '../lib/prefs'

export const Route = createFileRoute('/contacts/$id')({ component: ContactDetail })

const TIPE: { value: string; label: string }[] = [
  { value: 'otongan', label: 'Otonan (Pawukon 210 hari)' },
  { value: 'birthday', label: 'Ulang tahun' },
  { value: 'anniversary', label: 'Anniversary' },
]

function ContactDetail() {
  const { id } = Route.useParams()
  const qc = useQueryClient()
  const nav = useNavigate()
  const contact = useQuery({ queryKey: ['contact', id], queryFn: () => api<Contact>(`/contacts/${id}`) })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  const [type, setType] = useState('otongan')
  const [date, setDate] = useState('')
  const [pawukon, setPawukon] = useState('')
  const [offsets, setOffsets] = useState('')
  const [enabled, setEnabled] = useState(true)

  // Hidrasi form saat data kontak termuat/berubah (termasuk refetch setelah invalidate).
  useEffect(() => {
    if (!contact.data) return
    const form = hydratePrefsForm(contact.data.prefs)
    setOffsets(form.offsets)
    setEnabled(form.enabled)
  }, [contact.data])

  async function previewPawukon(d: string) {
    setPawukon('')
    if (!d || type !== 'otongan') return
    try { setPawukon((await api<{ label: string }>(`/pawukon?date=${d}`)).label) } catch { /* diam */ }
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
    qc.invalidateQueries({ queryKey: ['upcoming'] })
  }
  const addOcc = useMutation({
    mutationFn: () => api(`/contacts/${id}/occasions`, { method: 'POST', body: JSON.stringify({ type, date }) }),
    onSuccess: () => { setDate(''); setPawukon(''); invalidate() },
  })
  const delOcc = useMutation({
    mutationFn: (oid: number) => api(`/occasions/${oid}`, { method: 'DELETE' }), onSuccess: invalidate,
  })
  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/contacts/${id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  })
  const delContact = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => nav({ to: '/contacts' }),
  })

  if (contact.isLoading) return <p className="text-slate-500">Memuat…</p>
  if (contact.isError) return <p className="text-red-600">{String(contact.error)}</p>
  const c = contact.data!

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{c.name}</h1>
        <button onClick={() => { if (confirm(`Hapus ${c.name}?`)) delContact.mutate() }}
          className="text-sm text-red-600 hover:underline">Hapus kontak</button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Occasions</h2>
        {c.occasions.map((o) => (
          <div key={o.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
            <span>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs uppercase text-indigo-700">{o.type}</span>{' '}
              {o.base_date}
            </span>
            <button onClick={() => delOcc.mutate(o.id)} className="text-red-500 hover:underline">hapus</button>
          </div>
        ))}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {TIPE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="date" value={date}
            onChange={(e) => { setDate(e.target.value); previewPawukon(e.target.value) }}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          <button disabled={!date || addOcc.isPending} onClick={() => addOcc.mutate()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Tambah</button>
        </div>
        {pawukon && <p className="mt-2 text-sm text-emerald-700">🛕 {pawukon}</p>}
        {type === 'birthday' && date.endsWith('-02-29') && (
          <p className="mt-2 text-xs text-slate-500">29 Feb di tahun non-kabisat diperingati 1 Maret.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Preferensi Pengingat</h2>
        <p className="mb-2 text-sm text-slate-500">
          Default global: {(settings.data?.default_offsets ?? []).map((n) => `H-${n}`).join(', ')} · jam kirim {settings.data?.send_time}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={offsets} onChange={(e) => setOffsets(e.target.value)} placeholder="offset, mis. 7,4,2,1,0 (kosong = default)"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> aktif
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {channels.data?.channels.map((ch) => (
            <label key={ch.id} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-sm">
              <input type="checkbox"
                defaultChecked={c.prefs?.channel_ids.includes(ch.id) ?? false}
                onChange={(e) => {
                  const cur = new Set(c.prefs?.channel_ids ?? [])
                  e.target.checked ? cur.add(ch.id) : cur.delete(ch.id)
                  savePrefs.mutate({ channel_ids: [...cur] })
                }} />
              {ch.name} ({ch.type})
            </label>
          ))}
        </div>
        <button
          onClick={() => savePrefs.mutate({
            offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [],
            enabled,
          })}
          className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
          Simpan preferensi
        </button>
        {savePrefs.isError && <p className="mt-2 text-sm text-red-600">{String(savePrefs.error)}</p>}
      </section>
    </div>
  )
}
