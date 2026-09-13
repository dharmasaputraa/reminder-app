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

/** Zona waktu Indonesia — label WIB/WITA/WIT ditampilkan di option. */
const TZ_INDONESIA = [
  { value: 'Asia/Jakarta', name: 'WIB' },
  { value: 'Asia/Makassar', name: 'WITA' },
  { value: 'Asia/Jayapura', name: 'WIT' },
]

/** Zona umum lainnya (diaspora/travel); bisa ditambah — backend menerima
 *  semua nama IANA yang valid via time.LoadLocation. */
const TZ_LAINNYA = [
  'UTC',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
]

/** "GMT+8" untuk sebuah zona — dihitung dari tanggal saat ini sehingga ikut
 *  DST (mis. Sydney bergeser GMT+11 di musim panas). '' bila tak didukung. */
function gmtOffset(tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((x) => x.type === 'timeZoneName')
    const v = p?.value ?? ''
    if (!v.startsWith('GMT')) return ''
    return v === 'GMT' ? 'GMT+0' : v
  } catch {
    return ''
  }
}

function tzOptionText(tz: string, name?: string): string {
  const off = gmtOffset(tz)
  const suffix = [off, name].filter(Boolean).join(' · ')
  return suffix ? `${tz} (${suffix})` : tz
}

function SettingsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const [form, setForm] = useState<Settings | null>(null)
  const [offsetsText, setOffsetsText] = useState('')

  useEffect(() => {
    if (q.data && !form) {
      setForm(q.data)
      setOffsetsText(q.data.default_offsets.join(','))
    }
  }, [q.data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api('/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  if (!form && q.isError)
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Pengaturan</h1>
        <p className="text-sm text-red-600">
          Gagal memuat pengaturan: {String(q.error)} — periksa login/dev email lalu muat ulang halaman.
        </p>
      </div>
    )
  if (!form) return <p className="text-slate-500">Memuat…</p>
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })
  const saveNow = () =>
    save.mutate({
      ...form,
      default_offsets: offsetsText.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)),
    })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Pengaturan</h1>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          Timezone
          <select value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
            {/* nilai tersimpan yang tidak ada di list tetap tampil, tidak
                diam-diam diganti oleh select */}
            {!TZ_INDONESIA.some((t) => t.value === form.timezone) &&
              !TZ_LAINNYA.includes(form.timezone) && (
              <option value={form.timezone}>{tzOptionText(form.timezone)} — nilai tersimpan</option>
            )}
            <optgroup label="Indonesia">
              {TZ_INDONESIA.map((t) => (
                <option key={t.value} value={t.value}>{tzOptionText(t.value, t.name)}</option>
              ))}
            </optgroup>
            <optgroup label="Zona waktu lainnya">
              {TZ_LAINNYA.map((tz) => (
                <option key={tz} value={tz}>{tzOptionText(tz)}</option>
              ))}
            </optgroup>
          </select>
          <span className="mt-1 block text-xs text-slate-400">
            Menentukan "hari ini" untuk kalender dan jam kirim pengingat.
          </span>
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
          <input value={offsetsText}
            onChange={(e) => setOffsetsText(e.target.value)}
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
        <button onClick={saveNow} disabled={save.isPending}
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
