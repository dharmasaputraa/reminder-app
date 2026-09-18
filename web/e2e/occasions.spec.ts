import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { count, rowById } from './helpers/db'
import { seedContact, uniq } from './helpers/seed'

/** Pick a date in the occasion dialog: open the popover, type DD/MM/YYYY
 *  (a complete day commits and closes the popover — autoApply).
 *
 *  The popover is targeted by its own data-slot, not `getByRole('dialog')`:
 *  Base UI unmounts the popup on close, and a role-based locator would then
 *  re-resolve to the still-open add dialog, so `toBeHidden` could never pass. */
async function pickDate(page: Page, ddmmyyyy: string) {
  await page.getByRole('button', { name: 'Pick a date' }).click()
  const pop = page.locator('[data-slot="popover-content"]')
  await pop.getByRole('textbox').fill(ddmmyyyy)
  await expect(pop).toBeHidden()
}

async function openAddDialog(page: Page) {
  // With no occasions yet this is the empty state's "Add occasion"; the card
  // header's button is just "Add".
  await page.getByRole('button', { name: 'Add occasion' }).first().click()
  await expect(page.getByRole('dialog').last()).toBeVisible()
}

test('adds a yearly birthday (Feb 29) and the DB row matches', async ({ app, session }) => {
  const name = uniq('Feb29 Ida')
  const contactId = await seedContact(await session.apiAs(), { name })
  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)

  await openAddDialog(page)
  await page.locator('#occ-type').click()
  await page.getByRole('option', { name: 'Birthday' }).click()
  await pickDate(page, '29/02/2024')
  await expect(page.getByText('Feb 29 in non-leap years is observed on March 1.')).toBeVisible()
  await page.getByRole('button', { name: 'Add occasion' }).click()
  await expect(page.getByText('Occasion added')).toBeVisible()

  // node:sqlite: parameters go on get(), not on prepare().
  const occ = app.db
    .prepare('SELECT * FROM occasions WHERE contact_id = ? AND type = ?')
    .get(contactId, 'birthday') as any
  expect(occ).toMatchObject({ recurrence: 'yearly', base_date: '2024-02-29' })
})

test('custom type free-text + one-time recurrence', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Custom Type') })
  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)

  await openAddDialog(page)
  await page.locator('#occ-type').click()
  await page.getByRole('option', { name: 'Custom…' }).click()
  await page.locator('#occ-custom').fill('graduation')
  await page.locator('#occ-recurrence').click()
  await page.getByRole('option', { name: 'One-time' }).click()
  await pickDate(page, '15/08/2025')
  await page.getByRole('button', { name: 'Add occasion' }).click()
  await expect(page.getByText('Occasion added')).toBeVisible()

  const occ = app.db
    .prepare('SELECT * FROM occasions WHERE contact_id = ? AND type = ?')
    .get(contactId, 'graduation') as any
  expect(occ).toMatchObject({ recurrence: 'once', base_date: '2025-08-15' })
})

test('edits an occasion label via the Edit dialog', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Edit Occ') })
  const api = await session.apiAs()
  const { id: occId } = (await (
    await api.post(`/api/v1/contacts/${contactId}/occasions`, {
      data: { type: 'wedding', date: '2020-05-10', recurrence: 'yearly', label: 'Wedding day' },
    })
  ).json()) as { id: string }

  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)
  await page.getByRole('button', { name: 'More actions for wedding' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog').getByText('Edit wedding')).toBeVisible()
  await page.locator('#occ-label').fill('Anniversary luncheon')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Occasion updated')).toBeVisible()

  expect(rowById(app.db, 'occasions', occId).label).toBe('Anniversary luncheon')
})

test('deletes an occasion after confirm', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Del Occ') })
  const api = await session.apiAs()
  const { id: occId } = (await (
    await api.post(`/api/v1/contacts/${contactId}/occasions`, {
      data: { type: 'otonan', date: '2000-01-01', recurrence: 'otonan' },
    })
  ).json()) as { id: string }

  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)
  await page.getByRole('button', { name: 'More actions for otonan' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  // The confirm is a Base UI AlertDialog (role alertdialog); scope the action
  // so it cannot collide with the menu item that opened it.
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByText('Delete this occasion?')).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect.poll(() => count(app.db, 'occasions', { id: occId })).toBe(0)
})

test('per-occasion custom prefs write occasion_prefs (custom=1) and going back to inherit retains the row', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Occ Prefs') })
  const api = await session.apiAs()
  const occ = (await (
    await api.post(`/api/v1/contacts/${contactId}/occasions`, {
      data: { type: 'birthday', date: '1995-12-24', recurrence: 'yearly' },
    })
  ).json()) as { id: string }

  // occasion_prefs is keyed by occasion_id (PK) — there is no id column.
  const prefsRow = () =>
    app.db.prepare('SELECT * FROM occasion_prefs WHERE occasion_id = ?').get(occ.id) as
      | { custom: number; enabled: number; offsets: string }
      | undefined

  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)
  await page.getByRole('button', { name: /Toggle .* details/ }).click()
  await page.getByRole('switch', { name: 'Use custom reminders' }).click()
  await page.locator(`#occ-${occ.id}-offsets`).fill('10, 5, 0')
  await page.locator(`#occ-${occ.id}-offsets`).blur()

  await expect.poll(() => count(app.db, 'occasion_prefs', { occasion_id: occ.id })).toBe(1)
  // The offsets PUT is a separate (on-blur) save from the switch's — poll the
  // row's content, not just its existence, or the read below can race it.
  await expect
    .poll(() => {
      const row = prefsRow()
      return row ? ((JSON.parse(row.offsets).yearly ?? []) as number[]).join(',') : ''
    })
    .toBe('10,5,0')
  const prefs = prefsRow()
  expect(prefs).toBeDefined()
  expect(prefs).toMatchObject({ custom: 1, enabled: 1 })
  // The editor writes the single list to every stream the recurrence emits:
  // a yearly occasion emits both the event and the yearly stream.
  expect(JSON.parse(prefs!.offsets)).toEqual({ event: [10, 5, 0], yearly: [10, 5, 0] })

  // Turning the override off is a confirmed action, and it is a flag flip, not
  // a delete: the row is retained with custom=0 (inherit) so the saved days
  // come back when the override is re-enabled — see OccasionPrefsEditor.
  await page.getByRole('switch', { name: 'Use custom reminders' }).click()
  const inherit = page.getByRole('alertdialog')
  await expect(inherit.getByText('Switch to inherit reminders?')).toBeVisible()
  await inherit.getByRole('button', { name: 'Switch to inherit' }).click()
  await expect(page.getByRole('switch', { name: 'Use custom reminders' })).not.toBeChecked()
  await expect.poll(() => prefsRow()?.custom ?? -1).toBe(0)
  const retained = prefsRow()
  expect(retained).toMatchObject({ custom: 0, enabled: 1 })
  expect(JSON.parse(retained!.offsets)).toEqual({ event: [10, 5, 0], yearly: [10, 5, 0] })
})
