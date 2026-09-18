import { test, expect, MEMBER_A, MEMBER_B, ADMIN } from './fixtures'
import { count, rowById } from './helpers/db'
import { seedContact, seedOccasion, uniq } from './helpers/seed'

test('creates a contact via the full-page form and the DB row matches', async ({ app, session }) => {
  const name = uniq('Made Wijaya')
  const page = await session.pageAs()
  await page.goto('/reminder/contacts/new')
  await page.locator('#contact-name').fill(name)
  await page.locator('#contact-nickname').fill('Made')
  await page.locator('#contact-notes').fill('created by e2e')
  await page.getByRole('button', { name: 'Create contact' }).click()
  await expect(page.getByText('Contact created')).toBeVisible()

  const list = await (await session.apiAs()).get('/api/v1/contacts')
  const { contacts } = await (await list.json()) as { contacts: { id: string; name: string }[] }
  const created = contacts.find((c) => c.name === name)
  expect(created).toBeDefined()
  const row = rowById(app.db, 'contacts', created!.id)
  expect(row).toMatchObject({ name, nickname: 'Made', notes: 'created by e2e' })
  const owner = rowById(app.db, 'users', row.owner_id)
  expect(owner.email).toBe(MEMBER_A)
})

test('creates a contact via the docked panel (?c=new)', async ({ app, session }) => {
  const name = uniq('Docked Putu')
  const page = await session.pageAs()
  await page.goto('/reminder/contacts?c=new')
  await page.locator('#contact-name').fill(name)
  await page.getByRole('button', { name: 'Create contact' }).click()
  await expect(page.getByText('Contact created')).toBeVisible()
  expect(count(app.db, 'contacts', { name })).toBe(1)
})

test('Create contact stays disabled with an empty name', async ({ session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/contacts/new')
  await page.locator('#contact-name').fill('')
  await expect(page.getByRole('button', { name: 'Create contact' })).toBeDisabled()
})

test('edits a contact and the DB row follows', async ({ app, session }) => {
  const name = uniq('Edit Sari')
  const id = await seedContact(await session.apiAs(), { name })
  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${id}`)

  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await page.locator('#contact-name').fill(name + ' Revised')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Contact updated')).toBeVisible()

  expect(rowById(app.db, 'contacts', id).name).toBe(`${name} Revised`)
})

test('deleting a contact cascades to occasions and prefs in the DB', async ({ app, session }) => {
  const name = uniq('Cascade Ketut')
  const api = await session.apiAs()
  const id = await seedContact(api, { name })
  const occId = await seedOccasion(api, id, { type: 'birthday', date: '1990-06-15', recurrence: 'yearly' })
  const contactPrefs = await api.put(`/api/v1/contacts/${id}/prefs`, { data: { offsets: { yearly: [7, 0] } } })
  expect(contactPrefs.status(), await contactPrefs.text()).toBe(200)
  const occPrefs = await api.put(`/api/v1/occasions/${occId}/prefs`, { data: { offsets: { yearly: [7, 0] } } })
  expect(occPrefs.status(), await occPrefs.text()).toBe(200)
  // Both prefs rows exist before the delete — without this the post-delete
  // zero-counts below would pass even if nothing was cascaded.
  expect(count(app.db, 'reminder_prefs', { contact_id: id })).toBe(1)
  expect(count(app.db, 'occasion_prefs', { occasion_id: occId })).toBe(1)

  const page = await session.pageAs()
  await page.goto('/reminder/contacts')
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Contact deleted')).toBeVisible()

  expect(count(app.db, 'contacts', { id })).toBe(0)
  expect(count(app.db, 'occasions', { id: occId })).toBe(0)
  expect(count(app.db, 'reminder_prefs', { contact_id: id })).toBe(0)
  expect(count(app.db, 'occasion_prefs', { occasion_id: occId })).toBe(0)
})

test('delete confirm can be cancelled', async ({ app, session }) => {
  const name = uniq('Cancel Nyoman')
  const id = await seedContact(await session.apiAs(), { name })
  const page = await session.pageAs()
  await page.goto('/reminder/contacts')
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText(`Delete ${name}?`)).toBeHidden()
  expect(count(app.db, 'contacts', { id })).toBe(1)
})

test('search filters the grid', async ({ session }) => {
  const api = await session.apiAs()
  const a = uniq('Alpha Wayan')
  const b = uniq('Beta Kadek')
  await seedContact(api, { name: a })
  await seedContact(api, { name: b })
  const page = await session.pageAs()
  await page.goto('/reminder/contacts')
  // The row renders the name twice (visible cell + sr-only "Open {name}" link),
  // so target the first match — the assertion is that the row is on screen.
  await expect(page.getByText(a).first()).toBeVisible()
  await page.getByPlaceholder('Search name or nickname…').fill('Alpha Wayan'.slice(0, 12))
  await expect(page.getByText(a).first()).toBeVisible()
  await expect(page.getByText(b)).toHaveCount(0)
})

test('bogus deep-link shows the not-found page, not a crash', async ({ session }) => {
  const page = await session.pageAs()
  // Non-UUID ids fail the route's UUID guard: the beforeLoad redirect lands on
  // the list (the guard treats any non-UUID id as a bad URL) — not a crash.
  await page.goto('/reminder/contacts/not-a-uuid')
  await expect(page).toHaveURL(/\/reminder\/contacts\/?$/)

  // A UUID-shaped id that does not exist reaches the loader's 404 → the
  // router's not-found UI rather than an error boundary.
  await page.goto('/reminder/contacts/00000000-0000-4000-8000-000000000000')
  await expect(page.getByText('404')).toBeVisible()
  await expect(page.getByText('Page not found')).toBeVisible()
})

test('owner scoping: member B never sees member A data; admin sees all', async ({ app, session }) => {
  const name = uniq('Scoped Anak')
  const id = await seedContact(await session.apiAs(MEMBER_A), { name })

  const bApi = await session.apiAs(MEMBER_B)
  const bList = await (await bApi.get('/api/v1/contacts')).json()
  expect((bList.contacts as any[]).some((c) => c.name === name)).toBe(false)
  expect((await bApi.get(`/api/v1/contacts/${id}`)).status()).toBe(404)

  const adminApi = await session.apiAs(ADMIN)
  const aList = await (await adminApi.get('/api/v1/contacts')).json()
  expect((aList.contacts as any[]).some((c) => c.name === name)).toBe(true)

  const bPage = await session.pageAs(MEMBER_B)
  await bPage.goto('/reminder/contacts')
  // Anchor on the loaded grid (its search box) first — an empty-count check
  // against a still-loading skeleton would pass vacuously.
  await expect(bPage.getByPlaceholder('Search name or nickname…')).toBeVisible()
  await expect(bPage.getByText(name)).toHaveCount(0)

  const adminPage = await session.pageAs(ADMIN)
  await adminPage.goto('/reminder/contacts')
  await expect(adminPage.getByText(name).first()).toBeVisible()

  const ownerRow = app.db.prepare('SELECT id FROM users WHERE email = ?').get(MEMBER_A) as any
  expect(rowById(app.db, 'contacts', id).owner_id).toBe(ownerRow.id)
})
