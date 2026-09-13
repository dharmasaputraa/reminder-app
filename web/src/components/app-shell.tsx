import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Menu, X } from 'lucide-react'
import { api } from '@/lib/api'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/contacts', label: 'Kontak' },
  { to: '/channels', label: 'Channel' },
  { to: '/settings', label: 'Pengaturan' },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const email = me.data?.email ?? '…'
  const initial = me.data?.email ? me.data.email.slice(0, 1).toUpperCase() : '…'

  return (
    <main className="relative flex h-svh min-h-[600px] w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background">
        <div className="flex h-14 items-center gap-4 border-b px-4 lg:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setSheetOpen(true)}
            className="flex size-9 items-center justify-center rounded-md hover:bg-muted md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-w.svg" alt="Logo otorem" className="size-6" />
            <b>otorem</b>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                activeProps={{ className: 'bg-muted' }}
                className="flex h-9 items-center rounded-md px-2.5 text-sm font-medium hover:bg-muted"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((value) => !value)}
                className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-muted"
              >
                <span className="flex size-8 items-center justify-center rounded-full border text-xs">{initial}</span>
                <span className="hidden text-sm font-medium md:inline">{email}</span>
                <ChevronDown className="hidden size-3 md:block" />
              </button>
              {profileOpen && (
                <div className="absolute top-11 right-0 z-30 w-40 rounded-md border bg-popover p-1 text-sm shadow-lg">
                  <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">{email}</div>
                  <div className="px-2 py-1.5 text-xs">{me.data?.role ?? '…'}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <section className="flex flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </section>
      {sheetOpen && (
        <div className="absolute inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Dismiss navigation"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
          />
          <aside className="relative z-10 flex h-full w-[calc(100%-2rem)] max-w-[300px] flex-col border-r bg-background p-4 shadow-xl">
            <div className="flex items-center gap-2">
              <img src="/logo-w.svg" alt="Logo otorem" className="size-6" />
              <b>otorem</b>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="ml-auto flex size-8 items-center justify-center rounded-md hover:bg-muted"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="mt-12 space-y-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setSheetOpen(false)}
                  activeOptions={{ exact: item.to === '/' }}
                  activeProps={{ className: 'bg-muted' }}
                  className="flex h-9 items-center gap-2 rounded-md px-2 text-sm"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </main>
  )
}
