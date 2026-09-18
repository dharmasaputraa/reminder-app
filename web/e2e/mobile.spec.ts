import { test, expect } from './fixtures'
import { seedContact, uniq } from './helpers/seed'

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const

test('navigation sheet works on mobile and links to Contacts', async ({ session }) => {
  const page = await session.pageAs(undefined, MOBILE)
  await page.goto('/reminder')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  // exact: the dashboard body also renders a "Manage Contacts" link, and
  // without this the locator matches both whenever that content wins the race
  // with the sheet's own link.
  await page.getByRole('link', { name: 'Contacts', exact: true }).click()
  await expect(page).toHaveURL(/\/reminder\/contacts$/)
})

test('tapping a contact navigates to its detail page (no docked panel)', async ({ session }) => {
  const name = uniq('Mobile Nyoman')
  const id = await seedContact(await session.apiAs(), { name })
  const page = await session.pageAs(undefined, MOBILE)
  await page.goto('/reminder/contacts')
  // The worker DB is shared with other specs, and the grid is name-sorted and
  // paginated at 10 rows — filter down to this contact instead of assuming it
  // lands on page one. The row's own stretched link (sr-only "Open {name}") is
  // the element a real tap hits; the visible name sits underneath it, so
  // asking Playwright to click the text would only wait for pointer events
  // that the link intentionally captures.
  await page.getByPlaceholder('Search name or nickname…').fill(name)
  await page.getByRole('link', { name: `Open ${name}` }).click()
  await expect(page).toHaveURL(new RegExp(`/reminder/contacts/${id}$`))
  await expect(page.getByText(name).first()).toBeVisible()
})
