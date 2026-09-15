import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { addDays, format } from 'date-fns'
import { useTable } from '@tanstack/react-table'
import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table'
import { MoreHorizontalIcon, SearchIcon, Settings2Icon, StickyNoteIcon, XIcon } from 'lucide-react'
import { api, type Contact, type UpcomingItem } from '@/lib/api'
import { initials } from '@/lib/initials'
import { Badge } from '@/components/reui/badge'
import { DataGrid, dataGridFeatures, type DataGridFeatures } from '@/components/reui/data-grid/data-grid'
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header'
import { DataGridColumnVisibility } from '@/components/reui/data-grid/data-grid-column-visibility'
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination'
import { DataGridScrollArea } from '@/components/reui/data-grid/data-grid-scroll-area'
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table'
import { Frame, FrameFooter, FrameHeader, FramePanel } from '@/components/reui/frame'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'

/** Grid row = contact + its earliest upcoming occasion (absent when none
 *  falls inside the 400-day window). */
export interface ContactRow extends Contact {
  next?: UpcomingItem
}

/** contact_id → earliest occasion inside the endpoint's max 400-day window.
 *  Holidays are excluded; the countdown counts to the occasion date, not the
 *  first reminder send, and paused contacts still appear (spec). Failure
 *  degrades to an empty map — the column shows "—", the grid still works. */
export function useNextReminderMap(): {
  map: Map<number, UpcomingItem>
  isLoading: boolean
} {
  const today = new Date()
  const from = format(today, 'yyyy-MM-dd')
  const to = format(addDays(today, 400), 'yyyy-MM-dd')
  const q = useQuery({
    queryKey: ['upcoming', 'grid', from],
    queryFn: () => api<{ items: UpcomingItem[] }>(`/upcoming?from=${from}&to=${to}`),
  })
  const map = useMemo(() => {
    const m = new Map<number, UpcomingItem>()
    const items = (q.data?.items ?? [])
      .filter((it) => it.kind === 'occasion' && it.contact_id != null)
      .sort((a, b) => a.date.localeCompare(b.date))
    for (const it of items) if (!m.has(it.contact_id!)) m.set(it.contact_id!, it)
    return m
  }, [q.data])
  return { map, isLoading: q.isLoading }
}

/** occasion_id → its earliest upcoming occurrence in the window. Covers every
 *  occasion (unlike useNextReminderMap, which keeps only each contact's next)
 *  — used for per-occasion countdown chips. Shares the grid's query key, so
 *  mounting it costs no extra fetch. */
export function useUpcomingByOccasion(): {
  map: Map<number, UpcomingItem>
  isLoading: boolean
} {
  const today = new Date()
  const from = format(today, 'yyyy-MM-dd')
  const to = format(addDays(today, 400), 'yyyy-MM-dd')
  const q = useQuery({
    queryKey: ['upcoming', 'grid', from],
    queryFn: () => api<{ items: UpcomingItem[] }>(`/upcoming?from=${from}&to=${to}`),
  })
  const map = useMemo(() => {
    const m = new Map<number, UpcomingItem>()
    const items = (q.data?.items ?? [])
      .filter((it) => it.kind === 'occasion' && it.occasion_id != null)
      .sort((a, b) => a.date.localeCompare(b.date))
    for (const it of items) if (!m.has(it.occasion_id!)) m.set(it.occasion_id!, it)
    return m
  }, [q.data])
  return { map, isLoading: q.isLoading }
}

function ActionsCell({
  row,
  onSelect,
  onRequestDelete,
}: {
  row: Row<DataGridFeatures, ContactRow>
  onSelect: (id: number) => void
  onRequestDelete: (contact: Contact) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            // Above the row's stretched open-link (see the name column), so
            // the menu trigger stays clickable through the link overlay.
            className="relative z-10 size-7"
            size="icon"
            variant="ghost"
            aria-label={`Actions for ${row.original.name}`}
            // The row behind this cell opens the detail on click; the menu
            // trigger must not bubble into it (same pattern as the grid's
            // built-in pin button).
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onSelect(row.original.id)}>Open</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRequestDelete(row.original)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface ContactsGridProps {
  contacts: Contact[]
  nextById: Map<number, UpcomingItem>
  /** Currently docked contact, when the parent has one open. */
  selectedId?: number
  isLoading?: boolean
  /** Row click / Open — the parent decides docked selection vs. navigation. */
  onSelect: (id: number) => void
  /** Called after the confirm dialog; the parent owns the DELETE mutation. */
  onRequestDelete: (contact: Contact) => void
}

export function ContactsGrid({
  contacts,
  nextById,
  // selectedId is part of the contract (parent tracks the docked selection)
  // but the grid does not style rows by it yet — the open panel is the
  // selection feedback.
  isLoading,
  onSelect,
  onRequestDelete,
}: ContactsGridProps) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    occasions: false,
    notes: false,
  })
  const [searchQuery, setSearchQuery] = useState('')

  const rows = useMemo<ContactRow[]>(
    () => contacts.map((c) => ({ ...c, next: nextById.get(c.id) })),
    [contacts, nextById],
  )

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.nickname.toLowerCase().includes(q),
    )
  }, [rows, searchQuery])

  // Spec: pagination resets when search or sorting changes.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }, [searchQuery, sorting])

  const columns = useMemo<ColumnDef<DataGridFeatures, ContactRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        header: ({ column }) => <DataGridColumnHeader title="Name" column={column} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.name}</div>
              {row.original.nickname && (
                <div className="text-muted-foreground truncate text-xs">{row.original.nickname}</div>
              )}
            </div>
            {/* Notion-style row link: a real anchor stretched over the whole
                row (the row itself is `relative`), so cmd/ctrl+click,
                middle-click and the context menu open the contact page in a
                new tab natively. A plain click is prevented — the Link then
                bubbles into the row's onRowClick, keeping the docked-panel
                select (below lg: ordinary navigation) as the only handler. */}
            <Link
              to="/reminder/contacts/$id"
              params={{ id: String(row.original.id) }}
              className="absolute inset-0 rounded-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                  // Modifier clicks belong to the browser (new tab/window);
                  // keep them out of the row's plain-click select.
                  e.stopPropagation()
                  return
                }
                e.preventDefault()
              }}
            >
              <span className="sr-only">Open {row.original.name}</span>
            </Link>
          </div>
        ),
        enableSorting: true,
        enableHiding: false,
        enableResizing: false,
        size: 220,
        meta: { autoSize: true },
      },
      {
        id: 'next',
        // Missing next sorts last without a custom sortingFn.
        accessorFn: (row) => row.next?.days_until ?? Number.MAX_SAFE_INTEGER,
        header: ({ column }) => <DataGridColumnHeader title="Next reminder" column={column} />,
        cell: ({ row }) => {
          const n = row.original.next
          if (!n) return <span className="text-muted-foreground">—</span>
          return (
            <div className="flex items-center gap-2">
              <span className="truncate font-medium capitalize">
                {n.type} · {format(new Date(`${n.date}T00:00:00`), 'd MMM')}
              </span>
              <Badge variant={n.days_until <= 7 ? 'warning-outline' : 'secondary'} className="shrink-0">
                {n.days_until <= 0 ? 'today' : `in ${n.days_until}d`}
              </Badge>
            </div>
          )
        },
        enableSorting: true,
        enableHiding: true,
        enableResizing: false,
        size: 190,
        meta: { headerTitle: 'Next reminder' },
      },
      {
        id: 'occasions',
        header: ({ column }) => <DataGridColumnHeader title="Occasions" column={column} />,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.occasions.length === 0 && <span className="text-muted-foreground">—</span>}
            {row.original.occasions.map((o) => (
              <Badge key={o.id} variant="secondary" className="uppercase">
                {o.type} {format(new Date(`${o.base_date}T00:00:00`), 'd MMM yyyy')}
              </Badge>
            ))}
          </div>
        ),
        enableSorting: false,
        enableHiding: true,
        enableResizing: false,
        size: 240,
        meta: { headerTitle: 'Occasions' },
      },
      {
        id: 'status',
        accessorFn: (row) => row.prefs?.enabled ?? true,
        header: ({ column }) => <DataGridColumnHeader title="Status" column={column} />,
        cell: ({ row }) =>
          row.original.prefs?.enabled === false ? (
            <Badge variant="warning-outline">Paused</Badge>
          ) : (
            <Badge variant="success-outline">Active</Badge>
          ),
        enableSorting: true,
        enableHiding: true,
        enableResizing: false,
        size: 100,
        meta: { headerTitle: 'Status' },
      },
      {
        id: 'notes',
        accessorFn: (row) => row.notes,
        header: ({ column }) => <DataGridColumnHeader title="Notes" column={column} />,
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <StickyNoteIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{row.original.notes}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        enableSorting: false,
        enableHiding: true,
        enableResizing: false,
        size: 160,
        meta: { headerTitle: 'Notes' },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => <ActionsCell row={row} onSelect={onSelect} onRequestDelete={onRequestDelete} />,
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 60,
      },
    ],
    [onSelect, onRequestDelete],
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filtered,
    pageCount: Math.max(1, Math.ceil(filtered.length / pagination.pageSize)),
    getRowId: (row: ContactRow) => String(row.id),
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    // Without this updater the visibility state is write-never: the menu's
    // toggleVisibility() calls it, and only a state change re-renders columns.
    onColumnVisibilityChange: setColumnVisibility,
  })

  return (
    <DataGrid
      table={table}
      recordCount={filtered.length}
      isLoading={isLoading}
      onRowClick={(row) => onSelect(row.id)}
      // `relative` makes each row the containing block for its stretched
      // open-link (name column), which is what gives the whole row native
      // cmd/ctrl+click new-tab behavior.
      tableClassNames={{ bodyRow: 'relative' }}
      tableLayout={{
        columnsPinnable: false,
        columnsResizable: false,
        columnsMovable: false,
        columnsVisibility: true,
      }}
      emptyMessage={
        contacts.length === 0
          ? 'No contacts yet — add your first contact.'
          : 'No contacts match your search.'
      }
    >
      <Frame className="w-full" stacked dense>
        <FrameHeader className="flex w-full flex-row flex-wrap items-center justify-end gap-3">
          <InputGroup className="w-full max-w-64 bg-background sm:w-64">
            <InputGroupAddon align="inline-start">
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search name or nickname…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.length > 0 && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label="Clear search"
                  title="Clear"
                  size="icon-xs"
                  onClick={() => setSearchQuery('')}
                >
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <DataGridColumnVisibility
            table={table}
            trigger={
              <Button variant="outline" size="icon" aria-label="Toggle columns">
                <Settings2Icon aria-hidden="true" />
              </Button>
            }
          />
        </FrameHeader>
        <FramePanel className="p-0 shadow-none">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </FramePanel>
        <FrameFooter className="py-1.5 pr-2 pl-2.5">
          <DataGridPagination />
        </FrameFooter>
      </Frame>
    </DataGrid>
  )
}
