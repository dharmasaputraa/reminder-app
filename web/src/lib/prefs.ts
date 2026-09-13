import type { Prefs } from './api'

// Hidrasi form preferensi dari prefs tersimpan. Tanpa prefs (kontak baru / prefs:null):
// offsets kosong berarti "pakai default global" dan kontak dianggap aktif.
export function hydratePrefsForm(prefs?: Prefs | null): { offsets: string; enabled: boolean } {
  return { offsets: prefs?.offsets?.join(',') ?? '', enabled: prefs?.enabled ?? true }
}
