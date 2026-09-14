import { createRootRoute, HeadContent, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: () => (
    <>
      <HeadContent />
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster />
    </>
  ),
})
