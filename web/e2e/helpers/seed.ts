import { expect, type APIRequestContext } from '@playwright/test'
import type { SettingsPayload } from './time'
export type { SettingsPayload } from './time'

let counter = 0
export function uniq(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${counter++}`
}

export async function seedContact(
  request: APIRequestContext,
  body: { name: string; nickname?: string; notes?: string },
): Promise<string> {
  const res = await request.post('/api/v1/contacts', { data: body })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id
}

export async function seedOccasion(
  request: APIRequestContext,
  contactId: string,
  body: { type: string; date: string; recurrence: string; label?: string },
): Promise<string> {
  const res = await request.post(`/api/v1/contacts/${contactId}/occasions`, { data: body })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id
}

export async function seedChannel(
  request: APIRequestContext,
  body: { type: 'gotify' | 'telegram' | 'email'; name: string; config: Record<string, unknown> },
): Promise<string> {
  const res = await request.post('/api/v1/channels', { data: body })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id
}

export async function putSettings(request: APIRequestContext, settings: SettingsPayload): Promise<void> {
  const res = await request.put('/api/v1/settings', { data: settings })
  expect(res.status(), await res.text()).toBe(200)
}

export async function runScheduler(
  request: APIRequestContext,
): Promise<{ sent: number; failed: number; missed: number }> {
  const res = await request.post('/api/v1/scheduler/run')
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { sent: number; failed: number; missed: number }
}
