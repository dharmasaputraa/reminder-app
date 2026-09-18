import { test, expect } from './fixtures'
import { settingsJson } from './helpers/db'

/** Settings are a single row shared by the whole worker DB, and every save on
 *  this page PUTs the entire blob (all three tabs are one form, kept mounted).
 *  So the tests here are ordered: the defaults test must run before anything
 *  mutates the blob, and later tests assert their own write, never "the"
 *  state of the file. */
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
  await page.getByRole('button', { name: 'Save', exact: true }).click()
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
  // The category controls are Checkbox primitives (role=checkbox), not Switch;
  // the assertion intent is the same — flip two of the three and save.
  await page.getByRole('checkbox', { name: /Toggle Pawukon holidays/ }).click()
  await page.getByRole('checkbox', { name: /Toggle National holidays/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
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
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  expect(settingsJson(app.db).recurrence_offsets.yearly).toEqual([10, 5, 0])

  await page.locator('#rec-offsets-monthly').fill('')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('invalid send_time is rejected server-side and nothing changes', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/settings')
  const before = JSON.stringify(settingsJson(app.db)) // earlier tests in this file already saved
  await page.locator('#send-time').fill('25:99')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
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
