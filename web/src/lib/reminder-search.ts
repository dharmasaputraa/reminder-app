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

/** Route `validateSearch`: invalid params are overwritten with undefined.
 *  NOTE: this router version merges the validator's return over the raw
 *  search (Object.assign in router-core), so simply omitting an invalid key
 *  would leave its raw value in the typed search. Writing undefined clears
 *  it, and the search serializer drops undefined values, so the URL cleans
 *  itself up on the next navigation. */
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
  return { month, event }
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
