import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronDown, LayoutDashboard, Menu, Radio, Settings, Users, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const NAV_SECTIONS = [
  {
    section: 'Reminder',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/contacts', label: 'Kontak', icon: Users },
      { to: '/channels', label: 'Channel', icon: Radio },
      { to: '/settings', label: 'Pengaturan', icon: Settings },
    ],
  },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const email = me.data?.email ?? '…'
  const initial = me.data?.email ? me.data.email.slice(0, 1).toUpperCase() : '…'

  return (
    <main className="relative flex h-svh min-h-[600px] w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background">
        <div className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4 lg:px-6">
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
            </Link>
            <nav className="ml-4 hidden items-center gap-1 md:flex">
              {NAV_SECTIONS.map((navSection) => {
                const isActive = navSection.items.some((item) =>
                  item.to === '/' ? pathname === '/' : pathname.startsWith(item.to),
                )
                return (
                  <Link
                    key={navSection.section}
                    to={navSection.items[0].to}
                    className={cn(
                      'flex h-9 items-center rounded-md px-2.5 text-sm font-medium hover:bg-muted',
                      isActive && 'bg-muted',
                    )}
                  >
                    {navSection.section}
                  </Link>
                )
              })}
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
        </div>
        <div className="border-b bg-muted/30">
          <div className="mx-auto flex h-10 w-full max-w-5xl items-center gap-1 px-4 lg:px-6">
            {NAV_SECTIONS[0].items.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === '/' }}
                  activeProps={{ className: 'bg-accent text-accent-foreground' }}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-muted"
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      </header>
      <section className="flex flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
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
              {NAV_SECTIONS.map((navSection) => (
                <div key={navSection.section}>
                  <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                    {navSection.section.toUpperCase()}
                  </p>
                  <div>
                    {navSection.items.map((item) => {
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setSheetOpen(false)}
                          activeOptions={{ exact: item.to === '/' }}
                          activeProps={{ className: 'bg-muted' }}
                          className="flex h-9 items-center gap-2 rounded-md px-2 text-sm"
                        >
                          <Icon className="size-4" />
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </main>
  )
}
