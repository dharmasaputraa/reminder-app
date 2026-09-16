import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Minimize2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { ApiError, api, type Contact } from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

interface ContactEditFormProps {
  /** Contact id (UUID, edit), or 'new' (create). */
  contactId: string | 'new'
  /** panel = docked side section (the edit panel and the ?c=new create
   *  panel); page = the /new route (create only); dialog = below-lg edit
   *  dialog body (edit only — the Dialog owns the title bar). */
  variant: 'panel' | 'page' | 'dialog'
  /** panel only: the X button in the title bar. */
  onClose?: () => void
  /** Called after a successful identity save of an EXISTING contact — the
   *  host closes the panel/dialog. Create navigates to the detail page
   *  instead (see saveIdentity.onSuccess). */
  onSaved?: () => void
}

/** The identity edit/create surface (name, nickname, notes). Occasions and
 *  preferences are edited on the detail page, not here (revision spec). */
export function ContactEditForm({ contactId, variant, onClose, onSaved }: ContactEditFormProps) {
  const isNew = contactId === 'new'
  const id = isNew ? '' : contactId
  const qc = useQueryClient()
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
    enabled: !isNew,
  })

  // --- identity form ---
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!contact.data) return
    setName(contact.data.name)
    setNickname(contact.data.nickname)
    setNotes(contact.data.notes)
  }, [contact.data])

  const identityDirty = !contact.data
    ? name.trim() !== '' // create: ready as soon as there is a name
    : name !== contact.data.name || nickname !== contact.data.nickname || notes !== contact.data.notes

  const saveIdentity = useMutation({
    // Create returns the created contact; PATCH only returns {ok:true}.
    mutationFn: (): Promise<Contact | { ok: boolean }> => {
      const body = JSON.stringify({ name: name.trim(), nickname: nickname.trim(), notes })
      return isNew
        ? api<Contact>('/contacts', { method: 'POST', body })
        : api<{ ok: boolean }>(`/contacts/${id}`, { method: 'PATCH', body })
    },
    onSuccess: (saved) => {
      const savedId = 'id' in saved ? saved.id : null
      if (isNew && savedId != null) {
        // Flow (unchanged): after create, land on the fullscreen detail page.
        // Replace so no `new` URL stays in history.
        nav({ to: '/reminder/contacts/$id', params: { id: savedId }, replace: true })
        toast.success('Contact created')
        qc.invalidateQueries({ queryKey: ['contact', savedId] })
      } else if (!isNew) {
        toast.success('Contact updated')
        // The read-only identity beside/behind this form must drop the stale
        // name/notes — invalidate everything identity touches.
        qc.invalidateQueries({ queryKey: ['contact', id] })
        qc.invalidateQueries({ queryKey: ['contacts'] })
        qc.invalidateQueries({ queryKey: ['upcoming'] })
        onSaved?.()
      }
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError: (e) => toast.error(`Failed to save contact: ${String(e)}`),
  })

  // --- shared error / loading bodies (edit mode) ---
  const errorBlock = !isNew && contact.isError && (
    <div className="space-y-2">
      <p className="font-medium">
        {contact.error instanceof ApiError && contact.error.status === 404
          ? 'Contact not found'
          : 'Failed to load contact'}
      </p>
      {!(contact.error instanceof ApiError && contact.error.status === 404) && (
        <p className="text-sm text-red-600">{String(contact.error)}</p>
      )}
    </div>
  )
  const loadingBlock = !isNew && contact.isLoading && (
    <div className="space-y-2.5">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )

  const nameField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-name">Name</Label>
      <Input
        id="contact-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. Made Wijaya)"
      />
    </div>
  )
  const nicknameField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-nickname">Nickname</Label>
      <Input
        id="contact-nickname"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder="optional"
      />
    </div>
  )
  const notesField = (
    <div className="space-y-1.5">
      <Label htmlFor="contact-notes">Notes</Label>
      <Textarea
        id="contact-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="optional"
        rows={3}
      />
    </div>
  )

  // ============ PANEL: docked anatomy — h-11 title bar with the close
  // action, body, pinned Save/Create footer. ============
  if (variant === 'panel') {
    return (
      <div className="flex h-full flex-col text-sm">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold">{isNew ? 'New Contact' : 'Edit Contact'}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errorBlock ? (
            <div className="px-4 py-4">{errorBlock}</div>
          ) : loadingBlock ? (
            <div className="px-4 py-4">{loadingBlock}</div>
          ) : (
            <div className="px-4 py-4">
              {isNew && (
                <p className="text-muted-foreground mb-3 text-sm">
                  Occasions and preferences can be added on the detail page after saving.
                </p>
              )}
              <div className="space-y-3">
                {nameField}
                {nicknameField}
                {notesField}
              </div>
            </div>
          )}
        </div>
        <div className="border-t p-3">
          <Button
            className="w-full"
            disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
            onClick={() => saveIdentity.mutate()}
          >
            {isNew ? 'Create contact' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  // ============ PAGE (/new, create only): identity header + Card. ============
  if (variant === 'page') {
    return (
      <div className="space-y-5">
        <div className="relative">
          <div className="absolute end-0 top-0 flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back to list"
              onClick={() => nav({ to: '/reminder/contacts', replace: true })}
            >
              <Minimize2Icon aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">
                <UserPlusIcon aria-hidden="true" className="size-6" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <h1 className="text-pretty text-lg leading-snug font-semibold">New contact</h1>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground -mt-2 text-center text-sm">
          Occasions and preferences can be added on the detail page after saving.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {nameField}
              {nicknameField}
            </div>
            {notesField}
            <div className="flex justify-end">
              <Button
                disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
                onClick={() => saveIdentity.mutate()}
              >
                Create contact
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============ DIALOG: no own title bar (the Dialog supplies it), Save in
  // a footer row. ============
  return (
    <div className="text-sm">
      <div className="max-h-[60vh] min-h-0 space-y-4 overflow-y-auto">
        {errorBlock ? (
          errorBlock
        ) : loadingBlock ? (
          loadingBlock
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {nameField}
              {nicknameField}
            </div>
            {notesField}
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={!identityDirty || !name.trim() || saveIdentity.isPending}
          onClick={() => saveIdentity.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
