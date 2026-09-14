import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Contact } from '../lib/api'
import { pageTitle } from '../lib/page-title'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/reminder/contacts/')({
  component: Contacts,
  head: () => ({ meta: [{ title: pageTitle('Contacts') }] }),
})

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

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
      <h1 className="text-xl font-bold">Contacts</h1>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Made Wijaya)"
          className="flex-1" />
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          Add
        </Button>
      </form>
      {q.data?.contacts.map((c) => (
        <Link key={c.id} to="/reminder/contacts/$id" params={{ id: String(c.id) }} className="block">
          <Card className="flex-row items-center gap-3 p-3 transition-colors hover:ring-indigo-300">
            <Avatar>
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.name}{c.nickname ? ` · ${c.nickname}` : ''}</p>
              <p className="truncate text-sm text-muted-foreground">
                {c.occasions.length === 0
                  ? 'no occasions yet'
                  : c.occasions.map((o) => `${o.type} ${o.base_date}`).join(' · ')}
              </p>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}
