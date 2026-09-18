import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { settingsJson } from './helpers/db'

/** Every tab panel carries its own footer Save (one shared form state behind
 *  the tabs) and all panels stay mounted. An inactive panel only leaves the
 *  accessibility tree once its exit transition ends, so a bare
 *  `getByRole('button', { name: 'Save' })` can transiently match two buttons
 *  right after a tab switch. Scope by panel name instead. */
const saveIn = (page: Page, tab: 'General' | 'Holidays' | 'Recurrence') =>
  page.getByRole('tabpanel', { name: tab }).getByRole('button', { name: 'Save', exact: true })

/** Settings are a single row shared by the whole worker DB, and every save on
 *  this page PUTs the entire blob (all three tabs are one form, kept mounted).
 *  So the order below is a contract, not an accident of scheduling: serial
 *  mode pins these tests to one worker and runs them in declaration order, and
 *  the defaults test must run before anything mutates the blob. Later tests
 *  assert their own write, never "the" state of the file. */
test.describe.configure({ mode: 'serial' })

test('defaults load (send_time 08:00, Asia/Makassar)', async ({ session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/settings')
  await expect(page.locator('#send-time')).toHaveValue('08:00')
  await expect(page.getByText('Asia/Makassar').first()).toBeVisible()
})

test('saving General + offsets writes the exact JSON blob', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/settings')
  await page.locator('#send-time').fill('09:30')
  await page.locator('#catch-up').fill('12')
  await page.locator('#offsets').fill('7, 3, 0')
  // Scoped to the one Select on the page; the hidden native input the Select
  // renders is aria-hidden and never matches a role query.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: /Asia\/Jakarta/ }).click()
  await saveIn(page, 'General').click()
  await expect(page.getByText('Saved.')).toBeVisible()

  const s = settingsJson(app.db)
  expect(s).toMatchObject({
    timezone: 'Asia/Jakarta',
    send_time: '09:30',
    catch_up_hours: 12,
    default_offsets: [7, 3, 0],
  })
})

test('holiday toggles persist', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/settings')
  await page.getByRole('tab', { name: 'Holidays' }).click()
  // The category controls are Checkbox primitives (role=checkbox), not Switch.
  const box = (name: RegExp) => page.getByRole('checkbox', { name })

  // Precondition: nothing earlier in this file touches holidays, so the seeded
  // default must still be on. If this fails the ambient state is poisoned —
  // fail loudly here instead of silently "fixing" it below.
  await expect(box(/Toggle Balinese & Saka holidays/)).toBeChecked()

  // Force the absolute target state rather than flipping relative to whatever
  // loaded, so the final blob assertion holds from any starting point.
  const targets: [RegExp, boolean][] = [
    [/Toggle Pawukon holidays/, false],
    [/Toggle Balinese & Saka holidays/, true],
    [/Toggle National holidays/, false],
  ]
  for (const [name, want] of targets) {
    const b = box(name)
    if ((await b.isChecked()) !== want) await b.click()
    await expect(b).toBeChecked({ checked: want })
  }

  await saveIn(page, 'Holidays').click()
  await expect(page.getByText('Saved.')).toBeVisible()

  expect(settingsJson(app.db).holiday_categories).toEqual({
    pawukon: false, saka: true, national: false,
  })
})

test('recurrence offsets save; empty stream disables Save', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/settings')
  await page.getByRole('tab', { name: 'Recurrence' }).click()
  await page.locator('#rec-offsets-yearly').fill('10, 5, 0')
  await saveIn(page, 'Recurrence').click()
  await expect(page.getByText('Saved.')).toBeVisible()
  expect(settingsJson(app.db).recurrence_offsets.yearly).toEqual([10, 5, 0])

  await page.locator('#rec-offsets-monthly').fill('')
  await expect(saveIn(page, 'Recurrence')).toBeDisabled()
})

test('invalid send_time is rejected server-side and nothing changes', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/settings')
  const before = JSON.stringify(settingsJson(app.db)) // earlier tests in this file already saved
  await page.locator('#send-time').fill('25:99')
  await saveIn(page, 'General').click()
  await expect(page.getByText(/Failed to save/)).toBeVisible()
  expect(JSON.stringify(settingsJson(app.db))).toBe(before) // failed save persists nothing
})

test('invalid timezone is rejected by the API', async ({ session }) => {
  const res = await (await session.apiAs()).put('/api/v1/settings', {
    data: {
      timezone: 'Not/AZone', send_time: '08:00', catch_up_hours: 24,
      default_offsets: [0], default_channel_ids: null,
      holiday_categories: { pawukon: false, saka: false, national: false },
      holiday_offsets: {},
      recurrence_offsets: { event: [0], yearly: [0], monthly: [0], otonan: [0] },
    },
  })
  expect(res.status()).toBe(400)
})
