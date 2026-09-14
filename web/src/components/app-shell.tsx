import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, LayoutDashboard, Menu, Radio, Settings, Users, X } from 'lucide-react'
import { Logo } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'

const NAV_SECTIONS = [
  {
    section: 'Reminder',
    items: [
      { to: '/reminder', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/reminder/contacts', label: 'Contacts', icon: Users },
      { to: '/reminder/channels', label: 'Channels', icon: Radio },
      { to: '/reminder/settings', label: 'Settings', icon: Settings },
    ],
  },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string; role: string }>('/me') })
  const email = me.data?.email ?? '…'
  const initial = me.data?.email ? me.data.email.slice(0, 1).toUpperCase() : '…'

  return (
    <main className="relative flex h-svh min-h-[600px] w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background">
        <div className="border-b">
          {/* lg+ drops the centered max-w so the shell fills wide viewports;
              justify-between keeps two flex targets: brand+menu and account */}
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 lg:max-w-[1400px] lg:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setSheetOpen(true)}
                className="flex size-9 items-center justify-center rounded-md hover:bg-muted md:hidden"
              >
                <Menu className="size-5" />
              </button>
              <Link to="/" className="flex items-center gap-2">
                <Logo className="size-6 shrink-0" />
              </Link>
              <nav className="ml-2 hidden items-center gap-1 md:flex">
                {NAV_SECTIONS.map((navSection) => (
                  <Link
                    key={navSection.section}
                    to={navSection.items[0].to}
                    activeProps={{ className: 'bg-muted' }}
                    className="flex h-9 items-center rounded-md px-2.5 text-sm font-medium hover:bg-muted"
                  >
                    {navSection.section}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                    />
                  }
                >
                  <span className="flex size-5 items-center justify-center rounded-full border text-[10px]">{initial}</span>
                  <span className="hidden text-sm font-medium md:inline">{email}</span>
                  <ChevronDown className="hidden size-3 md:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="flex items-center gap-3 px-1 pt-1.5 pb-1.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border text-xs">
                      {initial}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">{email}</span>
                      <span className="truncate text-xs text-muted-foreground">{me.data?.role ?? '…'}</span>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <div className="py-2.5">
                    <ThemeToggle />
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <div className="border-b bg-muted/30">
          <div className="mx-auto flex h-10 w-full max-w-5xl items-center gap-1 px-4 lg:max-w-[1400px] lg:px-6">
            {NAV_SECTIONS[0].items.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === '/reminder' }}
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
      <section className="flex flex-1 overflow-y-auto pt-4 lg:pt-6">
        <div className="mx-auto w-full max-w-5xl px-4 lg:max-w-[1400px] lg:px-6">{children}</div>
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
              <Logo className="size-6 shrink-0" />
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
                          activeOptions={{ exact: item.to === '/reminder' }}
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
