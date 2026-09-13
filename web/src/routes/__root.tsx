import { Link, createRootRoute, Outlet } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/contacts', label: 'Kontak' },
  { to: '/channels', label: 'Channel' },
  { to: '/settings', label: 'Pengaturan' },
] as const

export const Route = createRootRoute({
  component: () => (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4!" />
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                activeProps={{ className: 'font-bold text-indigo-700' }}
                className="transition-colors hover:text-foreground data-[status=active]:font-bold"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 p-4">
          <div className="mx-auto w-full max-w-2xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  ),
})
