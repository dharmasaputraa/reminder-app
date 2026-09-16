import type { Prefs, Settings } from './api'

// Hydrate the preference form from stored prefs. Without prefs (new contact / prefs:null):
// empty offsets means "use the global default" and the contact is considered active.
export function hydratePrefsForm(prefs?: Prefs | null): { yearly: string; monthly: string; enabled: boolean } {
  return {
    yearly: (prefs?.offsets?.yearly ?? []).join(','),
    monthly: (prefs?.offsets?.monthly ?? []).join(','),
    enabled: prefs?.enabled ?? true,
  }
}

/** "7, 4, 0" → [7, 4, 0]; blanks and non-numbers are dropped. */
export function parseList(s: string): number[] {
  return s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n))
}

/** "[30, 7, 0]" → "D-30, D-7, on the day" — the copy form for offset lists. */
export function offsetsSummary(list?: number[]): string {
  return (list ?? []).map((n) => (n === 0 ? 'on the day' : `D-${n}`)).join(', ')
}

/** The per-recurrence default sets the contact form edits, as copy:
 *  "Yearly: D-30, D-7, … · Monthly: on the day". */
export function defaultSummary(settings?: Settings): string {
  return (
    `Yearly: ${offsetsSummary(settings?.recurrence_offsets?.yearly)} · ` +
    `Monthly: ${offsetsSummary(settings?.recurrence_offsets?.monthly)}`
  )
}
