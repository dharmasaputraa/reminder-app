const devEmailKey = 'wimember-dev-email'

export function devEmail(): string | null { return localStorage.getItem(devEmailKey) }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const email = devEmail()
  if (email) headers.set('X-Dev-Email', email)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/v1${path}`, { ...init, headers })
  if (res.status === 401 && !email) {
    const entered = window.prompt('Dev mode: enter your email (admin if listed in ADMIN_EMAILS)')
    if (entered) {
      localStorage.setItem(devEmailKey, entered.trim().toLowerCase())
      return api<T>(path, init)
    }
  }
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).error ?? msg } catch { /* keep statusText */ }
    throw new ApiError(res.status, msg)
  }
  return res.json()
}

export interface UpcomingItem {
  date: string; kind: 'occasion' | 'holiday'
  occasion_id?: number; contact_id?: number; contact_name?: string
  type?: string; number?: number
  title: string; pawukon?: string; days_until: number; reminders?: number[]
}
export interface Occasion { id: number; type: string; base_date: string; label: string }
export interface Prefs { contact_id: number; offsets: number[]; channel_ids: number[]; enabled: boolean }
export interface Contact { id: number; name: string; nickname: string; notes: string; occasions: Occasion[]; prefs: Prefs | null }
export interface Channel { id: number; type: string; name: string; enabled: boolean }
export interface Settings {
  timezone: string; send_time: string; catch_up_hours: number
  default_offsets: number[]; holiday_categories: Record<string, boolean>
  holiday_offsets: Record<string, number[]>
}
