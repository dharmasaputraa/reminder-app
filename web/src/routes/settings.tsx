import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Settings } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Tersimpan.')
    },
    onError: (e) => toast.error(`Gagal menyimpan: ${String(e)}`),
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

      <Card>
        <CardHeader>
          <CardTitle>Preferensi Pengingat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Timezone</FieldLabel>
            <Select value={form.timezone} onValueChange={(v) => set({ timezone: v ?? form.timezone })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih zona waktu" />
              </SelectTrigger>
              <SelectContent>
                {/* nilai tersimpan yang tidak ada di list tetap tampil */}
                {!TZ_INDONESIA.some((t) => t.value === form.timezone) &&
                  !TZ_LAINNYA.includes(form.timezone) && (
                  <SelectItem value={form.timezone}>{tzOptionText(form.timezone)} — nilai tersimpan</SelectItem>
                )}
                <SelectGroup>
                  <SelectLabel>Indonesia</SelectLabel>
                  {TZ_INDONESIA.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{tzOptionText(t.value, t.name)}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Zona waktu lainnya</SelectLabel>
                  {TZ_LAINNYA.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tzOptionText(tz)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>Menentukan "hari ini" untuk kalender dan jam kirim pengingat.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="send-time">Jam kirim (HH:MM)</FieldLabel>
            <Input id="send-time" value={form.send_time} onChange={(e) => set({ send_time: e.target.value })} />
          </Field>

          <Field>
            <FieldLabel htmlFor="catch-up">Catch-up window (jam)</FieldLabel>
            <Input
              id="catch-up"
              type="number"
              value={form.catch_up_hours}
              onChange={(e) => set({ catch_up_hours: Number(e.target.value) })}
            />
            <FieldDescription>Pengingat yang terlewat karena perangkat mati.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="offsets">Offset default (hari sebelum H, pisah koma)</FieldLabel>
            <Input id="offsets" value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kategori hari raya</legend>
            {KATEGORI.map((k) => (
              <label key={k.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.holiday_categories[k.key] ?? false}
                  onCheckedChange={(c) => set({ holiday_categories: { ...form.holiday_categories, [k.key]: c === true } })}
                />
                {k.label}
              </label>
            ))}
          </fieldset>

          <Button onClick={saveNow} disabled={save.isPending}>Simpan</Button>
        </CardContent>
      </Card>

      {me.data && (
        <p className="text-sm text-slate-500">
          Masuk sebagai <b>{me.data.email}</b> ({me.data.role}) — mode dev via header X-Dev-Email;
          produksi via Cloudflare Access.
        </p>
      )}
    </div>
  )
}
