import { test, expect, ADMIN, MEMBER_A } from './fixtures'
import type { APIRequestContext } from '@playwright/test'
import { notificationLog } from './helpers/db'
import { putSettings, runScheduler, seedChannel, seedContact, seedOccasion, uniq } from './helpers/seed'
import type { SettingsPayload } from './helpers/time'
import { dueSettings, futureSettings, utcDaysFromToday, utcToday } from './helpers/time'

/** Ambient-state hazards. There is no in-file fix: the admin scan is global by
 *  design (every owner's contacts), and a worker's app/DB is shared by every
 *  spec file that lands in it.
 *
 *  - channels.spec leaves MEMBER_A owning enabled channels, including an email
 *    channel the UI wrote with a string `to` — the SMTP notifier rejects that
 *    shape at resolve time, and resolve errors get no 15-minute backoff, so any
 *    scan that reaches one of MEMBER_A's due occurrences counts it `failed`
 *    every time. Sibling files (occasions/upcoming) also leave recurring
 *    occasions behind.
 *  - On a date when one of those leftover occurrences lands in the scan window,
 *    the manual run's counters pick up ambient sends/failures. A strict-zero
 *    counter failure (the future test's `res` in particular) can therefore be
 *    ambient state rather than a regression — check the scoped log rows, the
 *    stub delta and the app log before assuming a product bug.
 *  - The two-channel test asserts only `res.sent ≤ 2`: `failed`/`missed` are
 *    deliberately left unasserted there because ambient channels and contacts
 *    can move them; the scoped per-channel log rows and stub tokens already
 *    carry that test's coverage.
 */

/** A throwaway contact owner per test.
 *
 *  The scheduler delivers to EVERY enabled channel of the contact's owner, and
 *  the worker-scoped app/DB is shared by all tests in this file. Seeding under
 *  one shared owner (say ADMIN) leaks between tests: a later test's reminder
 *  fans out to the channels earlier tests left behind (measured: 2 log rows on
 *  the second due contact), and every channel added later is a fresh dedupe key
 *  for still-due earlier occurrences, so it re-delivers them (measured: the
 *  first test's stub token appearing a second time). A fresh owner makes the
 *  channels seeded here the only possible targets and keeps the log rows and
 *  stub deltas scoped to this test's contact. runScheduler stays admin-only:
 *  the admin scan sees every owner's contacts. */
const ownerEmail = (label: string) =>
  `${uniq(label).toLowerCase().replace(/\s+/g, '-')}@local.test`

/** Settings are one global row, and settings.spec's serial group asserts the
 *  shipped defaults (send_time 08:00, Asia/Makassar) in whichever worker it
 *  lands in. The queue order runs scheduler.spec first, so every test here puts
 *  the blob back exactly as it found it — without this the settings file's
 *  first test (and its five serial followers) fail on the UTC / now−2min blob
 *  left behind. */
let restoreSettings: (() => Promise<void>) | undefined

async function putSettingsTracked(api: APIRequestContext, next: SettingsPayload): Promise<void> {
  if (!restoreSettings) {
    const res = await api.get('/api/v1/settings')
    expect(res.status(), await res.text()).toBe(200)
    const original = await res.json()
    restoreSettings = async () => {
      const put = await api.put('/api/v1/settings', { data: original })
      expect(put.status(), await put.text()).toBe(200)
    }
  }
  await putSettings(api, next)
}

test.afterEach(async () => {
  await restoreSettings?.()
  restoreSettings = undefined
})

test('sends a due occasion: stub receipt + sent log row', async ({ app, session }) => {
  const admin = await session.apiAs(ADMIN)
  await putSettingsTracked(admin, dueSettings())
  // Snapshot after the settings write: a background tick can then only add
  // messages for other owners' contacts, never between put and snapshot.
  const before = app.stubMessages().length
  const api = await session.apiAs(ownerEmail('sched-due'))
  const today = utcToday()
  const name = uniq('Sched Made')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: today, recurrence: 'yearly' })
  const chId = await seedChannel(api, { type: 'gotify', name: uniq('sched-gotify'), config: { base_url: app.stubUrl, token: 'tok-1' } })

  const res = await runScheduler(admin)
  // The app's own per-minute loop (cmd/server/main.go) shares this settings
  // snapshot with the manual run: it may have delivered first, leaving the
  // manual run nothing to count. Bounded counters + terminal state instead.
  expect(res.sent).toBeLessThanOrEqual(1)
  expect(res.missed).toBe(0)

  // The stub is worker-cumulative, so slice off everything before this test.
  const msgs = app.stubMessages().slice(before).filter((m) => m.title.includes(name))
  expect(msgs).toHaveLength(1)
  expect(msgs[0].title).toContain(name)
  expect(msgs[0].message).toContain(`for ${name}`)
  expect(msgs[0].token).toBe('tok-1')

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(1)
  expect(log[0]).toMatchObject({ status: 'sent', offset_days: 0, channel_id: chId })
  expect(String(log[0].occurrence_date)).toContain(today) // serialized either as date or text
})

test('rerun dedupes: second run sends 0 and adds no rows', async ({ app, session }) => {
  const admin = await session.apiAs(ADMIN)
  await putSettingsTracked(admin, dueSettings())
  const before = app.stubMessages().length
  const api = await session.apiAs(ownerEmail('sched-dedupe'))
  const today = utcToday()
  const name = uniq('Dedupe')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: today, recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('dedupe-gotify'), config: { base_url: app.stubUrl, token: 'tok-2' } })

  // The first manual run may find the row already written by a background tick
  // — that is the point: whichever path delivered first, the second manual run
  // is a strict no-op.
  await runScheduler(admin)
  const second = await runScheduler(admin)
  expect(second).toEqual({ sent: 0, failed: 0, missed: 0 })

  expect(notificationLog(app.db, { occasion_id: occId })).toHaveLength(1)
  const msgs = app.stubMessages().slice(before).filter((m) => m.title.includes(name))
  expect(msgs).toHaveLength(1) // dedupe prevents the second push too
})

test('two enabled channels → one log row per channel, stub gets both', async ({ app, session }) => {
  const admin = await session.apiAs(ADMIN)
  await putSettingsTracked(admin, dueSettings())
  const before = app.stubMessages().length
  const api = await session.apiAs(ownerEmail('sched-two'))
  const today = utcToday()
  const name = uniq('Two Ch')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: today, recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('ch-a'), config: { base_url: app.stubUrl, token: 'tok-a' } })
  await seedChannel(api, { type: 'gotify', name: uniq('ch-b'), config: { base_url: app.stubUrl, token: 'tok-b' } })

  const res = await runScheduler(admin)
  expect(res.sent).toBeLessThanOrEqual(2) // a background tick may have sent some or all first

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(2)
  expect(new Set(log.map((r) => r.channel_id)).size).toBe(2)
  const tokens = app.stubMessages().slice(before)
    .filter((m) => m.title.includes(name))
    .map((m) => m.token).sort()
  expect(tokens).toEqual(['tok-a', 'tok-b'])
})

test('dead email channel fails without a log row; the healthy channel still sends', async ({ app, session }) => {
  const admin = await session.apiAs(ADMIN)
  await putSettingsTracked(admin, dueSettings())
  const before = app.stubMessages().length
  const api = await session.apiAs(ownerEmail('sched-fail'))
  const today = utcToday()
  const name = uniq('Fail Ch')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: today, recurrence: 'yearly' })
  const okId = await seedChannel(api, { type: 'gotify', name: uniq('ok-gotify'), config: { base_url: app.stubUrl, token: 'tok-ok' } })
  const deadId = await seedChannel(api, {
    type: 'email', name: uniq('dead-mail'),
    // `to` is the array SMTPConfig expects (a UI-created string would be
    // rejected before dialing); 127.0.0.1:9 refuses instantly.
    config: { host: '127.0.0.1', port: 9, username: 'u', password: 'p', from: 'f@local.test', to: ['t@local.test'] },
  })

  const res = await runScheduler(admin)
  // Bounded, not exact: a background tick may have consumed the failure first,
  // and the 15-minute in-memory backoff then suppresses the manual retry.
  expect(res.sent).toBeLessThanOrEqual(1)
  expect(res.failed).toBeLessThanOrEqual(1)

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(1) // failed sends are never recorded
  expect(log[0].channel_id).toBe(okId)
  expect(notificationLog(app.db, { channel_id: deadId })).toHaveLength(0)

  const msgs = app.stubMessages().slice(before).filter((m) => m.title.includes(name))
  expect(msgs).toHaveLength(1)
  expect(msgs[0].token).toBe('tok-ok')
})

test('occurrence beyond the catch-up window is recorded missed, not sent', async ({ app, session }) => {
  const admin = await session.apiAs(ADMIN)
  await putSettingsTracked(admin, dueSettings({ catchUpHours: 1 }))
  const before = app.stubMessages().length
  const api = await session.apiAs(ownerEmail('sched-missed'))
  const name = uniq('Missed')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcDaysFromToday(-2), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('missed-gotify'), config: { base_url: app.stubUrl, token: 'tok-m' } })

  const res = await runScheduler(admin)
  expect(res.sent).toBe(0)
  // No `res.missed` assertion on purpose: a background tick landing in the few
  // ms since the channel seed can write the row first and leave this run
  // nothing to count. The single 'missed' row below is the terminal evidence.

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(1) // one missed row per channel, never a send
  expect(log[0].status).toBe('missed')
  expect(app.stubMessages().slice(before).filter((m) => m.title.includes(name))).toHaveLength(0)
})

test('future send_time: nothing due, nothing logged', async ({ app, session }) => {
  const admin = await session.apiAs(ADMIN)
  await putSettingsTracked(admin, futureSettings())
  const before = app.stubMessages().length
  const api = await session.apiAs(ownerEmail('sched-future'))
  const name = uniq('Future')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcDaysFromToday(1), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('future-gotify'), config: { base_url: app.stubUrl, token: 'tok-f' } })

  // This file's other contacts are either still in the future (today-dated
  // occasions send at now+30min) or deduped by their own test's row, so the
  // manual scan has nothing at all to report.
  const res = await runScheduler(admin)
  expect(res).toEqual({ sent: 0, failed: 0, missed: 0 })
  expect(notificationLog(app.db, { occasion_id: occId })).toHaveLength(0)
  expect(app.stubMessages().slice(before).filter((m) => m.title.includes(name))).toHaveLength(0)
})

test('scheduler run is admin-only', async ({ session }) => {
  const res = await (await session.apiAs(MEMBER_A)).post('/api/v1/scheduler/run')
  expect(res.status()).toBe(403)
})
