import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTheme, type Theme } from '@/lib/theme'

const OPTIONS = [
  { value: 'light', label: 'Light theme', icon: SunIcon },
  { value: 'dark', label: 'Dark theme', icon: MoonIcon },
  { value: 'system', label: 'System theme', icon: MonitorIcon },
] satisfies { value: Theme; label: string; icon: typeof SunIcon }[]

// Icon-only theme picker, from the @reui/c-dropdown-menu-14 pattern.
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()

  return (
    <Tabs
      value={theme}
      onValueChange={(value: string) => {
        if (value === 'light' || value === 'dark' || value === 'system') setTheme(value)
      }}
    >
      <TabsList className="w-full">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} aria-label={label} className="h-6 flex-1">
            <Icon className="size-4" aria-hidden="true" />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
