import type { Prefs } from './api'

// Hydrate the preference form from stored prefs. Without prefs (new contact / prefs:null):
// empty offsets means "use the global default" and the contact is considered active.
export function hydratePrefsForm(prefs?: Prefs | null): { offsets: string; enabled: boolean } {
  return { offsets: prefs?.offsets?.join(',') ?? '', enabled: prefs?.enabled ?? true }
}
