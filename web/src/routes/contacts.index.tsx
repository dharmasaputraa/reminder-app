import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Contact } from '../lib/api'

export const Route = createFileRoute('/contacts/')({ component: Contacts })

function Contacts() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['contacts'], queryFn: () => api<{ contacts: Contact[] }>('/contacts') })
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => api('/contacts', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['contacts'] }) },
  })

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Kontak</h1>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama (mis. Made Wijaya)"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2" />
        <button disabled={create.isPending || !name.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
          Tambah
        </button>
      </form>
      {q.data?.contacts.map((c) => (
        <Link key={c.id} to="/contacts/$id" params={{ id: String(c.id) }}
          className="block rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300">
          <p className="font-medium">{c.name}{c.nickname ? ` · ${c.nickname}` : ''}</p>
          <p className="text-sm text-slate-500">
            {c.occasions.length === 0
              ? 'belum ada occasion'
              : c.occasions.map((o) => `${o.type} ${o.base_date}`).join(' · ')}
          </p>
        </Link>
      ))}
    </div>
  )
}
