export type SettingsPayload = {
  timezone: string
  send_time: string
  catch_up_hours: number
  default_offsets: number[]
  default_channel_ids: string[] | null
  holiday_categories: Record<string, boolean>
  holiday_offsets: Record<string, number[]>
  recurrence_offsets: Record<string, number[]>
}

const hm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function utcDaysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** Deterministic "due now": occasion dated TODAY is past its send time.
 *  send_time = now−2min; if that crossed midnight UTC, fall back to 00:00
 *  (today@00:00 is always in the past, and ≤2 min late so no "late" flag). */
export function dueSettings(opts: { catchUpHours?: number } = {}): SettingsPayload {
  const now = new Date()
  const minus2 = new Date(now.getTime() - 2 * 60_000)
  const sameDay = minus2.getUTCDate() === now.getUTCDate()
  return baseSettings(sameDay ? hm(minus2) : '00:00', opts.catchUpHours ?? 24)
}

/** Deterministic "not yet due": pair with an occasion dated TOMORROW. */
export function futureSettings(): SettingsPayload {
  return baseSettings(hm(new Date(Date.now() + 30 * 60_000)), 24)
}

function baseSettings(sendTime: string, catchUpHours: number): SettingsPayload {
  return {
    timezone: 'UTC',
    send_time: sendTime,
    catch_up_hours: catchUpHours,
    default_offsets: [0],
    default_channel_ids: null,
    holiday_categories: { pawukon: false, saka: false, national: false },
    holiday_offsets: {},
    recurrence_offsets: { event: [0], yearly: [0], monthly: [0], otonan: [0] },
  }
}
