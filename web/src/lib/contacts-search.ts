/** URL search contract for /reminder/contacts — see
 *  docs/superpowers/specs/2026-09-14-contacts-datagrid-master-detail-design.md. */
export interface ContactsSearch {
  /** Docked right-section target: a contact id or `new`. Absent = no panel.
   *  A NUMBER, not a numeric string: the router's type-preserving search
   *  serializer JSON-encodes numeric-looking strings (`?c=%221%22`), while a
   *  real number serializes as the plain `?c=1` the spec's URL contract shows. */
  c?: number | 'new'
}

/** Route `validateSearch`: invalid params are overwritten with undefined.
 *  Accepts both `?c=1` (parsed as a number by the router) and the quoted
 *  `?c=%221%22` / `?c=new` string forms for robustness.
 *  NOTE: this router version merges the validator's return over the raw
 *  search (Object.assign in router-core), so simply omitting an invalid key
 *  would leave its raw value in the typed search. Writing undefined clears
 *  it, and the search serializer drops undefined values, so the URL cleans
 *  itself up on the next navigation. (Same note as validateReminderSearch.) */
export function validateContactsSearch(
  search: Record<string, unknown>
): ContactsSearch {
  const raw = search.c
  let c: number | 'new' | undefined
  if (raw === 'new') c = 'new'
  else if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) c = raw
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) c = Number(raw)
  else c = undefined
  return { c }
}
