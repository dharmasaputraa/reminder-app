import { UUID_RE } from './api'

/** URL search contract for /reminder/contacts — see
 *  docs/superpowers/specs/2026-09-14-contacts-datagrid-master-detail-design.md. */
export interface ContactsSearch {
  /** Docked right-section target: a contact id (UUID string) or `new`.
   *  Absent = no panel. A string, not a number: ids are UUIDv7 now, and the
   *  router's type-preserving search serializer writes plain strings as-is
   *  (`?c=<uuid>`), same as it did for numbers before. */
  c?: string | 'new'
}

/** Route `validateSearch`: invalid params are overwritten with undefined.
 *  Accepts the plain `?c=<uuid>` form and the quoted `?c=%22<uuid>%22` /
 *  `?c=new` string forms for robustness.
 *  NOTE: this router version merges the validator's return over the raw
 *  search (Object.assign in router-core), so simply omitting an invalid key
 *  would leave its raw value in the typed search. Writing undefined clears
 *  it, and the search serializer drops undefined values, so the URL cleans
 *  itself up on the next navigation. (Same note as validateReminderSearch.) */
export function validateContactsSearch(
  search: Record<string, unknown>
): ContactsSearch {
  const raw = search.c
  let c: string | 'new' | undefined
  if (raw === 'new') c = 'new'
  else if (typeof raw === 'string' && UUID_RE.test(raw)) c = raw
  else c = undefined
  return { c }
}

/** URL search contract for /reminder/contacts/$id — the edit side section
 *  (lg) / edit dialog (below lg) is open while `edit` is present. */
export interface ContactDetailSearch {
  /** Present = the edit panel (lg) or edit dialog (below lg) is open.
   *  Open pushes (browser Back closes); close replace-drops so no stale
   *  history entry reopens it. */
  edit?: boolean
}

/** Route `validateSearch` for the contact detail page. Accepts `?edit=1`,
 *  `?edit=true`, and the bare `?edit` form. Writing undefined clears the
 *  key so the URL cleans itself up (same validator-merge note as
 *  validateContactsSearch above).
 *  NOTE: the router's default type-preserving search parser
 *  (JSON.parse-based) delivers plain `?edit=1` as the NUMBER 1, so the
 *  numeric check is the path plain deep links actually take; the string
 *  forms cover the quoted `?edit=%221%22` / `?edit=%22true%22` URLs for
 *  robustness. */
export function validateContactDetailSearch(
  search: Record<string, unknown>
): ContactDetailSearch {
  const raw = search.edit
  const edit =
    raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === ''
  return { edit: edit || undefined }
}
