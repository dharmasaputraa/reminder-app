import { test, expect, ADMIN, MEMBER_A } from './fixtures'
import { rows } from './helpers/db'

test('API rejects requests without a dev email (401)', async ({ app }) => {
  const res = await fetch(`${app.baseUrl}/api/v1/me`)
  expect(res.status).toBe(401)
})

test('API accepts the X-Dev-Email header and auto-provisions the user', async ({ app, session }) => {
  const api = await session.apiAs(MEMBER_A)
  const res = await api.get('/api/v1/me')
  expect(res.status()).toBe(200)
  await expect(res.json()).resolves.toMatchObject({ email: MEMBER_A, role: 'member' })
  const user = rows(app.db, 'SELECT email, role FROM users WHERE email = ?', MEMBER_A)[0]
  expect(user).toMatchObject({ email: MEMBER_A, role: 'member' })
})

test('the window.prompt login flow provisions the user', async ({ app, browser }) => {
  const ctx = await browser.newContext({ baseURL: app.baseUrl }) // no header, no localStorage
  const page = await ctx.newPage()
  let prompts = 0
  page.on('dialog', (d) => { prompts++; void d.accept('prompted@local.test') })
  await page.goto('/reminder')
  await expect(page.locator('header')).toContainText('prompted@local.test')
  expect(prompts).toBeGreaterThanOrEqual(1)
  const user = rows(app.db, 'SELECT email, role FROM users WHERE email = ?', 'prompted@local.test')[0]
  expect(user).toMatchObject({ email: 'prompted@local.test', role: 'member' })
  await ctx.close()
})

test('admin role comes from ADMIN_EMAILS; /users is admin-only', async ({ app, session }) => {
  const member = await session.apiAs(MEMBER_A)
  expect((await member.get('/api/v1/users')).status()).toBe(403)

  const admin = await session.apiAs(ADMIN)
  const res = await admin.get('/api/v1/users')
  expect(res.status()).toBe(200)
  const { users } = await res.json()
  expect(users.map((u: { email: string }) => u.email)).toContain(MEMBER_A)

  const adminRow = rows(app.db, 'SELECT email, role FROM users WHERE email = ?', ADMIN)[0]
  expect(adminRow).toMatchObject({ email: ADMIN, role: 'admin' })
})

test('account menu shows the signed-in email and admin role', async ({ session }) => {
  const page = await session.pageAs(ADMIN)
  await page.goto('/reminder')
  await page.getByRole('button', { name: new RegExp(ADMIN) }).click()
  await expect(page.getByRole('menu')).toContainText('admin')
})
