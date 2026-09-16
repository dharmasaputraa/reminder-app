import type { Prefs } from './api'

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
