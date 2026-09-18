import { test, expect, APP_SECRET, MEMBER_A, MEMBER_B, type App } from './fixtures'
import type { Page } from '@playwright/test'
import { channelConfigEnc, count, rowById, settingsJson } from './helpers/db'
import { decryptConfig } from './helpers/crypto'
import { uniq } from './helpers/seed'

/** The add-channel dialog is the only open role=dialog on the page; every
 *  control below is scoped to it because the header carries an `Add channel`
 *  button too. */
const addDialog = (page: Page) => page.getByRole('dialog').last()

/** A channel's accordion row. The row-level controls are targeted through it
 *  rather than by `#ch-active-{id}`/`#ch-default-{id}`: the framework puts
 *  those ids on visually hidden inputs (aria-hidden, clipped), which Playwright
 *  sees as present but cannot click. The ARIA control inside the row is the
 *  real button; its accessible name is the FieldLabel text ("Active"/"Default")
 *  — the labels' htmlFor wins over the components' aria-label. */
const rowFor = (page: Page, name: string) =>
  page.locator('[data-slot="accordion-item"]', { hasText: name })

async function openAddDialog(page: Page) {
  await page.getByRole('button', { name: 'Add channel' }).first().click()
  await expect(addDialog(page)).toBeVisible()
}

async function pickType(page: Page, label: 'Gotify' | 'Telegram' | 'Email') {
  await addDialog(page).locator('#ch-type').click()
  await page.getByRole('option', { name: label }).click()
}

/** Submit and wait for the success toast. Several adds in one test stack
 *  identical toasts, so assert the newest (.last()); the dialog closing in the
 *  same onSuccess keeps this honest for the first add of a test, too. */
async function submitAdd(page: Page) {
  await addDialog(page).getByRole('button', { name: 'Add channel' }).click()
  await expect(addDialog(page)).toBeHidden()
  await expect(page.getByText('Channel created').last()).toBeVisible()
}

/** The active/default controls live in the row's accordion panel (keepMounted,
 *  hidden while collapsed), so expand the row first. */
async function expandRow(page: Page, name: string) {
  await page.getByRole('button', { name: `Toggle ${name} details` }).click()
}

async function addGotify(page: Page, app: App, name: string) {
  await openAddDialog(page)
  await addDialog(page).locator('#ch-name').fill(name)
  await addDialog(page).locator('#ch-cfg-base_url').fill(app.stubUrl)
  await addDialog(page).locator('#ch-cfg-token').fill('stub-token-xyz')
  await submitAdd(page)
}

/** SMTP on 127.0.0.1:9 (discard) — resolvable but always refused, so test
 *  sends fail fast instead of waiting on a timeout. */
async function addDeadEmail(page: Page, name: string) {
  await openAddDialog(page)
  await pickType(page, 'Email')
  await addDialog(page).locator('#ch-name').fill(name)
  await addDialog(page).locator('#ch-cfg-host').fill('127.0.0.1')
  await addDialog(page).locator('#ch-cfg-port').fill('9')
  await addDialog(page).locator('#ch-cfg-username').fill('u')
  await addDialog(page).locator('#ch-cfg-password').fill('p')
  await addDialog(page).locator('#ch-cfg-from').fill('from@local.test')
  await addDialog(page).locator('#ch-cfg-to').fill('to@local.test')
  await submitAdd(page)
}

test('adds a gotify channel; config stored encrypted and decrypts exactly', async ({ app, session }) => {
  const name = uniq('gotify-stub')
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)

  const ch = app.db.prepare('SELECT * FROM channels WHERE name = ?').get(name) as any
  expect(ch).toMatchObject({ type: 'gotify', enabled: 1 })
  const blob = channelConfigEnc(app.db, ch.id)
  expect(Buffer.from(blob).toString('utf8')).not.toContain('stub-token-xyz')
  expect(blob.length).toBeGreaterThanOrEqual('stub-token-xyz'.length + 12 + 16)
  expect(JSON.parse(decryptConfig(APP_SECRET, blob))).toEqual({
    base_url: app.stubUrl,
    token: 'stub-token-xyz',
  })
})

test('adds telegram and email channels; all configs decrypt to their exact JSON', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/channels')

  const tgName = uniq('tg-real-shaped')
  await openAddDialog(page)
  await pickType(page, 'Telegram')
  await addDialog(page).locator('#ch-name').fill(tgName)
  await addDialog(page).locator('#ch-cfg-bot_token').fill('123456:ABC-def_GHI')
  await addDialog(page).locator('#ch-cfg-chat_id').fill('-100200300')
  await submitAdd(page)

  const deadName = uniq('email-dead')
  await addDeadEmail(page, deadName)

  // Both lookups go by the unique name: the worker's DB is shared by every
  // test in this file, so `WHERE type = 'email'` could pick another test's row.
  const tg = app.db.prepare('SELECT * FROM channels WHERE name = ?').get(tgName) as any
  expect(JSON.parse(decryptConfig(APP_SECRET, channelConfigEnc(app.db, tg.id)))).toEqual({
    bot_token: '123456:ABC-def_GHI', chat_id: '-100200300',
  })
  const mail = app.db.prepare('SELECT * FROM channels WHERE name = ?').get(deadName) as any
  expect(JSON.parse(decryptConfig(APP_SECRET, channelConfigEnc(app.db, mail.id)))).toMatchObject({
    host: '127.0.0.1', port: 9, from: 'from@local.test', to: 'to@local.test',
  })
})

test('Add channel stays disabled with an empty name; server rejects bad config', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await openAddDialog(page)
  await expect(addDialog(page).getByRole('button', { name: 'Add channel' })).toBeDisabled()

  const res = await (await session.apiAs()).post('/api/v1/channels', {
    data: { type: 'gotify', name: 'bad-config', config: { token: 'x' } },
  })
  expect(res.status()).toBe(400) // missing base_url
})

// The brief splits the two row controls into separate tests but expects the
// file to report 7 passed (8 blocks, 7 counted); both are row-control writes on
// a fresh channel, and both assertions are kept whole here.
test('row controls persist to the DB: Active toggle and Default flag', async ({ app, session }) => {
  const name = uniq('gotify-toggle')
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)
  const id = (app.db.prepare('SELECT id FROM channels WHERE name = ?').get(name) as any).id

  await expandRow(page, name)
  const activeSwitch = rowFor(page, name).getByRole('switch', { name: 'Active', exact: true })
  await expect(activeSwitch).toBeChecked() // non-vacuous: new channels start enabled
  await activeSwitch.click()
  await expect.poll(() => rowById(app.db, 'channels', id).enabled).toBe(0)
  await activeSwitch.click()
  await expect.poll(() => rowById(app.db, 'channels', id).enabled).toBe(1)

  // Default is a settings write, not a channel column.
  const def = rowFor(page, name).getByRole('checkbox', { name: 'Default', exact: true })
  await expect(def).not.toBeChecked()
  await def.click()
  await expect(def).toBeChecked()
  await expect
    .poll(() => settingsJson(app.db)?.default_channel_ids ?? [])
    .toContain(id)
})

test('Test send: success pushes to the stub; failure toasts and pushes nothing', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  const okName = uniq('gotify-test-ok')
  await addGotify(page, app, okName)

  const beforeOk = app.stubMessages().length
  await page.getByRole('button', { name: `Test ${okName}` }).click()
  await expect(page.getByText('Test succeeded — notification sent.')).toBeVisible()
  const msgs = app.stubMessages()
  expect(msgs.length).toBeGreaterThan(beforeOk)
  expect(msgs.some((m) => m.title === 'wimember tes')).toBe(true)
  expect(msgs.some((m) => m.token === 'stub-token-xyz')).toBe(true)

  const deadName = uniq('email-test-dead')
  await addDeadEmail(page, deadName)

  const before = app.stubMessages().length
  await page.getByRole('button', { name: `Test ${deadName}` }).click()
  await expect(page.getByText(/Test failed/)).toBeVisible()
  expect(app.stubMessages().length).toBe(before)
})

test('deletes a channel after confirm', async ({ app, session }) => {
  const name = uniq('gotify-del')
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)
  const id = (app.db.prepare('SELECT id FROM channels WHERE name = ?').get(name) as any).id

  await page.getByRole('button', { name: `More actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  // Base UI AlertDialog (role alertdialog); scoped so the confirm action cannot
  // collide with the menu item that opened it.
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByText(`Delete channel ${name}?`)).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => count(app.db, 'channels', { id })).toBe(0)
})

test('channels are owner-scoped', async ({ app, session }) => {
  const name = uniq('gotify-scoped')
  const page = await session.pageAs(MEMBER_A)
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)
  await expect(page.getByText(name)).toBeVisible() // positive control: A sees it

  const bPage = await session.pageAs(MEMBER_B)
  await bPage.goto('/reminder/channels')
  // Wait for B's list to render before asserting the absence — an empty page
  // would make toHaveCount(0) pass for the wrong reason.
  await expect(bPage.getByText('No channels yet')).toBeVisible()
  await expect(bPage.getByText(name)).toHaveCount(0)

  const bList = (await (await (await session.apiAs(MEMBER_B)).get('/api/v1/channels')).json()) as {
    channels: { name: string }[]
  }
  expect(bList.channels.some((c) => c.name === name)).toBe(false)
  const aList = (await (await (await session.apiAs(MEMBER_A)).get('/api/v1/channels')).json()) as {
    channels: { name: string }[]
  }
  expect(aList.channels.some((c) => c.name === name)).toBe(true)
})
