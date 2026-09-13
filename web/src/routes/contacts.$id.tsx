import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Channel, type Contact, type Settings } from '../lib/api'
import { hydratePrefsForm } from '../lib/prefs'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

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
  const [dateObj, setDateObj] = useState<Date | undefined>(undefined)
  const [dateOpen, setDateOpen] = useState(false)
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
    onSuccess: () => { setDate(''); setDateObj(undefined); setPawukon(''); invalidate() },
  })
  const delOcc = useMutation({
    mutationFn: (oid: number) => api(`/occasions/${oid}`, { method: 'DELETE' }), onSuccess: invalidate,
  })
  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/contacts/${id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e) => toast.error(`Gagal menyimpan preferensi: ${String(e)}`),
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{c.name}</h1>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm">Hapus kontak</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus {c.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Semua occasion dan preferensi pengingat kontak ini ikut terhapus.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={() => delContact.mutate()}>Hapus</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Occasions</CardTitle>
        </CardHeader>
        <CardContent>
          {c.occasions.map((o) => (
            <div key={o.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
              <span className="flex items-center gap-2">
                <Badge variant="secondary" className="uppercase">{o.type}</Badge>
                {o.base_date}
              </span>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="destructive" size="sm">Hapus</Button>} />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus occasion ini?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {o.type} {o.base_date} akan dihapus permanen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => delOcc.mutate(o.id)}>Hapus</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              value={type}
              onValueChange={(v) => {
                if (!v) return
                setType(v)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih tipe" />
              </SelectTrigger>
              <SelectContent>
                {TIPE.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger
                render={
                  <Button variant="outline" className="justify-start font-normal">
                    <CalendarIcon className="size-4" />
                    {dateObj ? format(dateObj, 'yyyy-MM-dd') : 'Pilih tanggal'}
                  </Button>
                }
              />
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateObj}
                  onSelect={(d) => {
                    setDateObj(d)
                    const iso = d ? format(d, 'yyyy-MM-dd') : ''
                    setDate(iso)
                    setDateOpen(false)
                    previewPawukon(iso)
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button disabled={!date || addOcc.isPending} onClick={() => addOcc.mutate()}>Tambah</Button>
          </div>
          {pawukon && <p className="mt-2 text-sm text-emerald-700">🛕 {pawukon}</p>}
          {type === 'birthday' && date.endsWith('-02-29') && (
            <p className="mt-2 text-xs text-slate-500">29 Feb di tahun non-kabisat diperingati 1 Maret.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferensi Pengingat</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm text-slate-500">
            Default global: {(settings.data?.default_offsets ?? []).map((n) => `H-${n}`).join(', ')} · jam kirim {settings.data?.send_time}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={offsets} onChange={(e) => setOffsets(e.target.value)} placeholder="offset, mis. 7,4,2,1,0 (kosong = default)"
              className="flex-1" />
            <label className="flex items-center gap-1.5 text-sm">
              <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              aktif
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {channels.data?.channels.map((ch) => (
              <label key={ch.id} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-sm">
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
          <Button
            className="mt-3"
            onClick={() => savePrefs.mutate({
              offsets: offsets.trim() ? offsets.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [],
              enabled,
            })}
          >
            Simpan preferensi
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
