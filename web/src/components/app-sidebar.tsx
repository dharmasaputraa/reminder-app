import { Link, useRouterState } from '@tanstack/react-router'
import { BellRingIcon } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

/** Menu sidebar data-driven — modul self-app baru (catatan, kebiasaan, dst.)
 *  tinggal nambah entri di sini (spec: visi aplikasi ingatan). */
export const SIDEBAR_MODULES = [{ to: '/', label: 'Autoreminder' }] as const

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="otorem" render={<Link to="/" />}>
              <img src="/logo-w.svg" alt="Logo otorem" className="size-7" />
              <span className="text-base font-black tracking-tight">otorem</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>App</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SIDEBAR_MODULES.map((m) => (
                <SidebarMenuItem key={m.to}>
                  <SidebarMenuButton
                    tooltip={m.label}
                    isActive={pathname === m.to}
                    render={<Link to={m.to} />}
                  >
                    <BellRingIcon />
                    <span>{m.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
