import type { UpcomingItem } from './api'

/** URL search contract for /reminder/ — see
 *  docs/superpowers/specs/2026-09-14-reminder-url-sync-design.md. */
export interface ReminderSearch {
  /** Visible calendar month, `YYYY-MM`. */
  month?: string
  /** Opened event: `occasion-<occasion_id>` or `holiday-<YYYY-MM-DD>`. */
  event?: string
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const EVENT_RE = /^(occasion-\d+|holiday-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))$/

/** Route `validateSearch`: keeps only well-formed params, drops the rest so a
 *  bad URL self-cleans instead of erroring. */
export function validateReminderSearch(
  search: Record<string, unknown>
): ReminderSearch {
  const month =
    typeof search.month === 'string' && MONTH_RE.test(search.month)
      ? search.month
      : undefined
  const event =
    typeof search.event === 'string' && EVENT_RE.test(search.event)
      ? search.event
      : undefined
  return { ...(month && { month }), ...(event && { event }) }
}

/** Stable URL identity for an item. Occasions are keyed by id (two different
 *  occasions can fall on the same date); holidays have no id, and kind+date
 *  is unique for them. Returns null only for an occasion missing its id —
 *  the backend always sends one, so callers just skip such an item. */
export function reminderEventId(it: UpcomingItem): string | null {
  if (it.kind === 'occasion')
    return it.occasion_id != null ? `occasion-${it.occasion_id}` : null
  return `holiday-${it.date}`
}

/** Look a URL event id up in already-fetched items. */
export function findReminderItem(
  items: UpcomingItem[],
  eventId: string
): UpcomingItem | undefined {
  if (eventId.startsWith('occasion-')) {
    const id = Number(eventId.slice('occasion-'.length))
    return items.find((it) => it.kind === 'occasion' && it.occasion_id === id)
  }
  const date = eventId.slice('holiday-'.length)
  return items.find((it) => it.kind === 'holiday' && it.date === date)
}
