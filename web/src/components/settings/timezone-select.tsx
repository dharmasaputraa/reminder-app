import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Indonesian time zones — WIB/WITA/WIT labels are shown in the option. */
const TZ_INDONESIA = [
  { value: 'Asia/Jakarta', name: 'WIB' },
  { value: 'Asia/Makassar', name: 'WITA' },
  { value: 'Asia/Jayapura', name: 'WIT' },
]

/** Other common zones (diaspora/travel); more can be added — the backend accepts
 *  any valid IANA name via time.LoadLocation. */
const TZ_LAINNYA = [
  'UTC',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
]

/** "GMT+8" for a zone — computed from the current date so it follows
 *  DST (e.g. Sydney shifts to GMT+11 in summer). '' when unsupported. */
function gmtOffset(tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((x) => x.type === 'timeZoneName')
    const v = p?.value ?? ''
    if (!v.startsWith('GMT')) return ''
    return v === 'GMT' ? 'GMT+0' : v
  } catch {
    return ''
  }
}

function tzOptionText(tz: string, name?: string): string {
  const off = gmtOffset(tz)
  const suffix = [off, name].filter(Boolean).join(' · ')
  return suffix ? `${tz} (${suffix})` : tz
}

/** Grouped timezone Select (Indonesia / other) with GMT-offset suffixes. */
export function TimezoneSelect({ value, onChange }: {
  value: string
  onChange: (tz: string) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => { if (v) onChange(v) }}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent>
        {/* a stored value not in the list is still shown */}
        {!TZ_INDONESIA.some((t) => t.value === value) &&
          !TZ_LAINNYA.includes(value) && (
          <SelectItem value={value}>{tzOptionText(value)} — stored value</SelectItem>
        )}
        <SelectGroup>
          <SelectLabel>Indonesia</SelectLabel>
          {TZ_INDONESIA.map((t) => (
            <SelectItem key={t.value} value={t.value}>{tzOptionText(t.value, t.name)}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Other timezones</SelectLabel>
          {TZ_LAINNYA.map((tz) => (
            <SelectItem key={tz} value={tz}>{tzOptionText(tz)}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
