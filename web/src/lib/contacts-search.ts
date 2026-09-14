/** URL search contract for /reminder/contacts — see
 *  docs/superpowers/specs/2026-09-14-contacts-datagrid-master-detail-design.md. */
export interface ContactsSearch {
  /** Docked right-section target: a contact id or `new`. Absent = no panel. */
  c?: string
}

const C_RE = /^(new|\d+)$/

/** Route `validateSearch`: invalid params are overwritten with undefined.
 *  NOTE: this router version merges the validator's return over the raw
 *  search (Object.assign in router-core), so simply omitting an invalid key
 *  would leave its raw value in the typed search. Writing undefined clears
 *  it, and the search serializer drops undefined values, so the URL cleans
 *  itself up on the next navigation. (Same note as validateReminderSearch.) */
export function validateContactsSearch(
  search: Record<string, unknown>
): ContactsSearch {
  const c =
    typeof search.c === 'string' && C_RE.test(search.c) ? search.c : undefined
  return { c }
}
