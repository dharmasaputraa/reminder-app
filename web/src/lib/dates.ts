import { format } from 'date-fns'

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (confirm dialogs, page rows). */
export function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

/** Compact variant for narrow rows: "Wed, 18 Jun 2003". */
export function shortDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEE, d MMM yyyy')
}
