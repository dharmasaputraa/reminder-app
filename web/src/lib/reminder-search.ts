import { UUID_SRC, type UpcomingItem } from './api'

/** URL search contract for /reminder/ — see
 *  docs/superpowers/specs/2026-09-14-reminder-url-sync-design.md. */
export interface ReminderSearch {
  /** Visible calendar month, `YYYY-MM`. */
  month?: string
  /** Opened event: `occasion-<occasion_id>-<YYYY-MM-DD>` or
   *  `holiday-<YYYY-MM-DD>` — the date names the exact occurrence. */
  event?: string
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_SRC = '\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])'
/** Occasion ids are UUIDs now; the trailing date names the occurrence. */
const EVENT_RE = new RegExp(`^(occasion-${UUID_SRC}|holiday)-${DATE_SRC}$`, 'i')
const OCCASION_EVENT_RE = new RegExp(`^occasion-(${UUID_SRC})-(\\d{4}-\\d{2}-\\d{2})$`, 'i')
const HOLIDAY_EVENT_RE = /^holiday-(\d{4}-\d{2}-\d{2})$/

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

/** Stable URL identity for an item. Occasions are keyed by id plus their
 *  occurrence date (two different occasions can fall on the same date, and one
 *  recurring occasion recurs several times inside the fetched window); holidays
 *  have no id, and kind+date is unique for them. Returns null only for an
 *  occasion missing its id — the backend always sends one, so callers just
 *  skip such an item. */
export function reminderEventId(it: UpcomingItem): string | null {
  if (it.kind === 'occasion')
    return it.occasion_id != null ? `occasion-${it.occasion_id}-${it.date}` : null
  return `holiday-${it.date}`
}

/** Look a URL event id up in already-fetched items. The id embeds the exact
 *  occurrence date, so recurring occasions resolve to the right one. */
export function findReminderItem(
  items: UpcomingItem[],
  eventId: string
): UpcomingItem | undefined {
  const occasion = eventId.match(OCCASION_EVENT_RE)
  if (occasion) {
    const id = occasion[1]
    return items.find(
      (it) => it.kind === 'occasion' && it.occasion_id === id && it.date === occasion[2]
    )
  }
  const holiday = eventId.match(HOLIDAY_EVENT_RE)
  return holiday
    ? items.find((it) => it.kind === 'holiday' && it.date === holiday[1])
    : undefined
}
