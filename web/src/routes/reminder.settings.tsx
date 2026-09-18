import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '../lib/page-title'
import { SettingsPageContent } from '@/components/settings/settings-page-content'

export const Route = createFileRoute('/reminder/settings')({
  component: SettingsPage,
  head: () => ({ meta: [{ title: pageTitle('Settings') }] }),
})

function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>
      <SettingsPageContent />
    </div>
  )
}
