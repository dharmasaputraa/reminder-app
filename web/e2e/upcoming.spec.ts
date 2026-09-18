import { test, expect } from './fixtures'
import type { APIRequestContext } from '@playwright/test'
import { notificationLog } from './helpers/db'
import { seedChannel, seedContact, seedOccasion, uniq } from './helpers/seed'

/** The calendar's own "today", read from the API instead of the JS clock:
 *  worker-scoped fixtures are reused across files, so the settings suite may
 *  already have moved the (single, global) settings timezone within this
 *  worker — a UTC seed date would then miss the window after 16:00 UTC. */
async function serverToday(api: APIRequestContext): Promise<string> {
  const res = await api.get('/api/v1/upcoming?days=1')
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()).today
}

function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

test('agenda lists a birthday due today and an event due tomorrow', async ({ session }) => {
  const api = await session.apiAs()
  const name = uniq('Agenda Made')
  const contactId = await seedContact(api, { name })
  const today = await serverToday(api)
  await seedOccasion(api, contactId, { type: 'birthday', date: today, recurrence: 'yearly' })
  await seedOccasion(api, contactId, { type: 'wedding', date: plusDays(today, 1), recurrence: 'once' })

  const page = await session.pageAs()
  await page.goto('/reminder')
  // The lg agenda row's accessible name is the item title plus the contact
  // name subtitle; the name is the stable part (titles carry counts like
  // "Birthday #1"), so match on it.
  await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible()

  const res = await api.get('/api/v1/upcoming?days=3')
  const { items } = await res.json()
  const birthday = items.find((i: any) => i.type === 'birthday' && i.contact_name === name)
  expect(birthday).toMatchObject({ kind: 'occasion', days_until: 0 })
  const wedding = items.find((i: any) => i.type === 'wedding' && i.contact_name === name)
  expect(wedding).toMatchObject({ kind: 'occasion', days_until: 1 })
})

test('Remind Now sends via the stub but never writes notification_log', async ({ app, session }) => {
  // A fresh actor: the default member's channel list is shared across spec
  // files in a worker (channels.spec leaves channels behind), and the trigger
  // only stays a direct "Remind Now" button with exactly ONE enabled channel.
  const email = `${uniq('remind-solo').toLowerCase().replace(/\s+/g, '-')}@local.test`
  const api = await session.apiAs(email)
  const name = uniq('Remind Komang')
  const contactId = await seedContact(api, { name })
  // Keep the app's per-minute scheduler (cmd/server/main.go tick → scheduler
  // scan) off this contact: a tick landing between the seed and the assertion
  // would deliver — and log — the same birthday, breaking both the stub-delta
  // and the empty-log checks. Contact prefs are a scheduler-only kill switch;
  // the manual /upcoming/notify path never reads them, so Remind Now still
  // sends. (Merge PUT: only `enabled` changes.)
  const off = await api.put(`/api/v1/contacts/${contactId}/prefs`, { data: { enabled: false } })
  expect(off.status(), await off.text()).toBe(200)
  const today = await serverToday(api)
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: today, recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('stub-gotify'), config: { base_url: app.stubUrl, token: 'stub-token-xyz' } })

  const page = await session.pageAs(email)
  await page.goto('/reminder')
  await page.getByRole('button', { name: new RegExp(name) }).first().click()
  // The stub is worker-scoped, so an earlier channels-spec test-send may
  // already have landed in it — assert on the messages this click adds.
  const before = app.stubMessages().length
  // One enabled channel → the detail footer's trigger IS the button (no picker).
  await page.getByRole('button', { name: 'Remind Now' }).first().click()
  await expect(page.getByText('Reminder sent to 1 channel.')).toBeVisible()

  const msgs = app.stubMessages().slice(before)
  expect(msgs).toHaveLength(1)
  expect(msgs[0].title).toContain(name)
  expect(msgs[0].message).toContain(`for ${name}`)
  // A manual push must not suppress or duplicate the scheduler's own dedupe.
  expect(notificationLog(app.db, { occasion_id: occId })).toHaveLength(0)
})

test('otonan lands today for a base date 210 days ago', async ({ session }) => {
  const api = await session.apiAs()
  const name = uniq('Otonan Wayan')
  const contactId = await seedContact(api, { name })
  const today = await serverToday(api)
  await seedOccasion(api, contactId, {
    type: 'otonan', date: plusDays(today, -210), recurrence: 'otonan',
  })
  const { items } = await (await api.get('/api/v1/upcoming?days=2')).json()
  const oto = items.find((i: any) => i.type === 'otonan' && i.contact_name === name)
  expect(oto).toMatchObject({ kind: 'occasion', date: today, days_until: 0 })
})

test('Feb 29 birthday is observed on Mar 1 in non-leap years', async ({ session }) => {
  const api = await session.apiAs()
  const name = uniq('Leap Dayu')
  const contactId = await seedContact(api, { name })
  await seedOccasion(api, contactId, { type: 'birthday', date: '2024-02-29', recurrence: 'yearly' })
  const { items } = await (await api.get('/api/v1/upcoming?from=2027-02-20&to=2027-03-05')).json()
  const feb29 = items.find((i: any) => i.type === 'birthday' && i.contact_name === name)
  expect(feb29.date).toBe('2027-03-01')
})

test('upcoming range validation: 400s and the silent days clamp', async ({ session }) => {
  const api = await session.apiAs()
  expect((await api.get('/api/v1/upcoming?from=2026-01-01&to=2025-01-01')).status()).toBe(400)
  expect((await api.get('/api/v1/upcoming?from=2026-01-01&to=2027-06-01')).status()).toBe(400) // > 400 days
  expect((await api.get('/api/v1/upcoming?from=nope')).status()).toBe(400)
  expect((await api.get('/api/v1/upcoming?days=500')).status()).toBe(200) // clamped, not an error
})
