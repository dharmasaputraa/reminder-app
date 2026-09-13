import { Link, createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <span className="text-lg font-black tracking-tight">otorem 🛕</span>
        <nav className="flex gap-4 text-sm text-slate-600">
          <Link to="/" activeProps={{ className: 'font-bold text-indigo-700' }}>Dashboard</Link>
          <Link to="/contacts" activeProps={{ className: 'font-bold text-indigo-700' }}>Kontak</Link>
          <Link to="/channels" activeProps={{ className: 'font-bold text-indigo-700' }}>Channel</Link>
          <Link to="/settings" activeProps={{ className: 'font-bold text-indigo-700' }}>Pengaturan</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  ),
})
