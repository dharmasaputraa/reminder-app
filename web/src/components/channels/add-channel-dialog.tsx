import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ChannelIcon } from '@/lib/channel-icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ChannelType = 'gotify' | 'telegram' | 'email'

/** The channel types with their brand marks — the reUI c-select-32 shape:
 *  object items, icon + label in both the items and the trigger value. */
const TIPE: { value: ChannelType; label: string; icon: ReactNode }[] = [
  { value: 'gotify', label: 'Gotify', icon: <ChannelIcon type="gotify" className="size-4" /> },
  { value: 'telegram', label: 'Telegram', icon: <ChannelIcon type="telegram" className="size-4" /> },
  { value: 'email', label: 'Email', icon: <ChannelIcon type="email" className="size-4" /> },
]

const FIELDS: Record<ChannelType, { key: string; label: string; type?: string }[]> = {
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

/** Add-channel dialog: type + name + per-type config (stored encrypted).
 *  The route owns the open state; on success the form resets and the
 *  dialog closes. Same shape as OccasionForm — labeled Field rows, submit
 *  in the DialogFooter band. */
export function AddChannelDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [type, setType] = useState<ChannelType>('gotify')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<Record<string, string | number>>({})
  // The select is object-valued (the c-select-32 shape); the form keeps
  // working off the plain string.
  const typeItem = TIPE.find((t) => t.value === type) ?? TIPE[0]

  const create = useMutation({
    mutationFn: () => api('/channels', { method: 'POST', body: JSON.stringify({ type, name, config: cfg }) }),
    onSuccess: () => {
      setName('')
      setCfg({})
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Channel created')
      onOpenChange(false)
    },
    onError: (e) => toast.error(`Failed to create channel: ${String(e)}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-left">Add channel</DialogTitle>
          <DialogDescription className="text-left">
            A delivery channel for reminders — Gotify, Telegram, or email.
          </DialogDescription>
        </DialogHeader>
        {/* Wrapped in a form so Enter in the text inputs submits. */}
        <form onSubmit={(e) => { e.preventDefault(); if (!name.trim() || create.isPending) return; create.mutate() }}>
          {/* pb-5: extra air between the last field and the footer band. */}
          <div className="pb-5">
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="ch-type">Type</FieldLabel>
                <Select
                  value={typeItem}
                  items={TIPE}
                  onValueChange={(item) => {
                    if (!item || item.value === type) return
                    setType(item.value)
                    setCfg({})
                  }}
                >
                  <SelectTrigger id="ch-type" className="w-full">
                    <SelectValue>
                      {(item: (typeof TIPE)[number]) => (
                        <span className="flex items-center gap-2">
                          {item.icon}
                          <span>{item.label}</span>
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {TIPE.map((t) => (
                        <SelectItem key={t.value} value={t}>
                          <span className="flex items-center gap-2">
                            {t.icon}
                            <span>{t.label}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="ch-name">Name</FieldLabel>
                <Input
                  id="ch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. gotify-home"
                />
              </Field>
              {FIELDS[type].map((f) => (
                <Field key={f.key}>
                  <FieldLabel htmlFor={`ch-cfg-${f.key}`}>{f.label}</FieldLabel>
                  <Input
                    id={`ch-cfg-${f.key}`}
                    type={f.type ?? 'text'}
                    required
                    value={cfg[f.key] ?? ''}
                    onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                  />
                </Field>
              ))}
            </FieldGroup>
            <Alert className="mt-3">
              <AlertTitle>Config is stored encrypted (AES-256-GCM)</AlertTitle>
              <AlertDescription>It cannot be viewed again after saving.</AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>Add channel</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
