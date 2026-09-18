# E2E Playwright Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Playwright e2e suite that drives the built `bin/wimember` (embedded SPA + Go + real SQLite) through every user flow — happy path and edge case — with direct SQLite assertions (post-action state, scheduler dedupe, owner scoping, channel-config encryption).

**Architecture:** Each Playwright worker spawns its own `bin/wimember` on a free port with a fresh temp `DATA_DIR` (real migrations, real `wimember.db`), plus an in-process Gotify stub (`node:http`) that records pushed messages. A test-scoped `session` fixture hands out per-identity browser contexts (`X-Dev-Email` header + `localStorage['wimember-dev-email']` pre-seeded) and API request contexts. `node:sqlite` reads the worker's DB file for assertions; `node:crypto` decrypts `config_enc` with the fixed test `APP_SECRET`.

**Tech Stack:** Playwright (chromium only), TypeScript, `node:sqlite`, `node:crypto`, `node:http`, `node:child_process`, pnpm 11, Node ≥ 22.13 (repo dev = 24.18.1).

**Spec:** `docs/superpowers/specs/2026-09-18-e2e-playwright-design.md`

## Global Constraints

- Tests live in `web/e2e/`; run via `make e2e` (= `make build` + `cd web && pnpm exec playwright test`). The SPA is the **production build embedded in the binary** — never the Vite dev server.
- Fixed server env per worker: `AUTH_MODE=dev`, `APP_SECRET=e2e-app-secret-0123456789` (25 chars), `ADMIN_EMAILS=admin@local.test`, `TZ=UTC`, `ADDR=127.0.0.1:<free port>`, `DATA_DIR=<mkdtemp dir>`.
- Identities: `admin@local.test` (admin), `member-a@local.test`, `member-b@local.test` (members). Header `X-Dev-Email`; localStorage key `wimember-dev-email`.
- DB file: `<DATA_DIR>/wimember.db`. Tables (lowercase): `users`, `contacts`, `occasions`, `reminder_prefs`, `occasion_prefs`, `channels`, `notification_log`, `settings`, `holiday_cache`, `schema_migrations`. Channel config column: `config_enc` (BLOB = 12-byte nonce ‖ ciphertext ‖ 16-byte GCM tag; key = `sha256(APP_SECRET)`).
- No test may reach the internet. The only remote endpoints used are `127.0.0.1` (the app, the Gotify stub, dead SMTP `127.0.0.1:9`).
- Scheduler determinism: settings `timezone: "UTC"`, `holiday_categories` all `false`, `default_offsets` / all `recurrence_offsets` streams `[0]`; "due" = occasion today + `send_time` ≈ now−2 min (UTC-day-cross guard falls back to `00:00`); "future" = occasion tomorrow + `send_time` ≈ now+30 min.
- Chromium single engine; `trace: 'retain-on-failure'`, HTML report; `web/.gitignore` covers `test-results/` and `playwright-report/`.
- Commit style: `test(web): …` (matches repo's `feat(web):`/`style(web):` convention).
- Web `pnpm run lint` must stay green: oxlint ignores `e2e/` (`--ignore-pattern=e2e`).

---

### Task 1: Playwright scaffold (config, deps, Makefile, global guard)

**Files:**
- Modify: `web/package.json` (devDep + scripts)
- Create: `web/playwright.config.ts`
- Create: `web/e2e/global-setup.ts`
- Create: `web/.gitignore`
- Modify: `Makefile` (add `e2e` target)
- Modify: `.github/workflows/ci.yml` — NOT in this task (Task 11)

**Interfaces:**
- Produces: `web/playwright.config.ts` with `testDir './e2e'`, `outputDir 'test-results'`, `globalSetup './e2e/global-setup.ts'`; scripts `test:e2e`, `test:e2e:report`; Makefile target `e2e`.

- [ ] **Step 1: Add Playwright dependency and scripts**

```bash
cd web && pnpm add -D @playwright/test && pnpm exec playwright install chromium
```

Then edit `web/package.json` scripts to:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint --ignore-pattern=e2e",
    "preview": "vite preview",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

- [ ] **Step 2: Create `web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [['html', { open: 'never' }], ['line']],
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
```

- [ ] **Step 3: Create `web/e2e/global-setup.ts`**

```ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default function globalSetup() {
  const bin = fileURLToPath(new URL('../../bin/wimember', import.meta.url))
  if (!existsSync(bin)) {
    throw new Error(
      `bin/wimember not found at ${bin}. Run "make build" first (or use "make e2e"), ` +
        'which builds the SPA into internal/api/webroot and the Go binary.',
    )
  }
}
```

- [ ] **Step 4: Create `web/.gitignore`**

```
node_modules
dist
test-results
playwright-report
```

- [ ] **Step 5: Add Makefile target** (after `build:` block in `Makefile`, and add `e2e` to `.PHONY`)

```make
# E2E: build SPA+binary, then run the Playwright suite (web/e2e).
e2e: build
	cd web && pnpm exec playwright test
```

- [ ] **Step 6: Verify scaffold**

Run: `cd web && pnpm exec playwright test --list`
Expected: exits 0; reports no tests found (or an empty list) — globalSetup path check passes when `bin/wimember` exists, and after `rm bin/wimember` the run fails with the `make build` hint.

Run: `cd web && pnpm run lint`
Expected: PASS (oxlint with e2e ignored).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/playwright.config.ts web/e2e/global-setup.ts web/.gitignore Makefile
git commit -m "test(web): scaffold playwright e2e (config, make target, build guard)"
```

---

### Task 2: `app` worker fixture (real server + DB handle) and db helpers

**Files:**
- Create: `web/e2e/fixtures.ts`
- Create: `web/e2e/helpers/db.ts`
- Create: `web/e2e/smoke.spec.ts`

**Interfaces:**
- Produces:
  - `test` (extended Playwright `test`) exported from `web/e2e/fixtures.ts`
  - Worker-scoped fixture `app: App` where
    `type App = { baseUrl: string; dataDir: string; dbPath: string; db: import('node:sqlite').DatabaseSync }`
  - Constants exported from `fixtures.ts`: `APP_SECRET = 'e2e-app-secret-0123456789'`, `ADMIN = 'admin@local.test'`, `MEMBER_A = 'member-a@local.test'`, `MEMBER_B = 'member-b@local.test'`
  - `helpers/db.ts` exports: `rows(db, sql, ...params): any[]`; `rowById(db, table, id): any`; `count(db, table, where?: Record<string, unknown>): number`; `settingsJson(db): any`; `notificationLog(db, filter?: { occasion_id?: string; status?: string; channel_id?: string }): any[]`; `channelConfigEnc(db, id): Uint8Array`

- [ ] **Step 1: Write `web/e2e/helpers/db.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite'

export function rows(db: DatabaseSync, sql: string, ...params: unknown[]): any[] {
  return db.prepare(sql).all(...params) as any[]
}

export function rowById(db: DatabaseSync, table: string, id: string): any {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
}

export function count(db: DatabaseSync, table: string, where?: Record<string, unknown>): number {
  const keys = where ? Object.keys(where) : []
  const sql = `SELECT COUNT(*) AS n FROM ${table}` +
    (keys.length ? ` WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}` : '')
  const r = db.prepare(sql).get(...(where ? Object.values(where) : [])) as any
  return r.n as number
}

/** The settings table stores one JSON blob under key 'settings'. */
export function settingsJson(db: DatabaseSync): any {
  const r = db.prepare(`SELECT value FROM settings WHERE key = 'settings'`).get() as any
  return r ? JSON.parse(r.value as string) : null
}

export function notificationLog(
  db: DatabaseSync,
  filter: { occasion_id?: string; status?: string; channel_id?: string } = {},
): any[] {
  const keys = Object.keys(filter).filter((k) => (filter as any)[k] !== undefined)
  const sql = 'SELECT * FROM notification_log' +
    (keys.length ? ` WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}` : '') +
    ' ORDER BY sent_at, id'
  return rows(db, sql, ...keys.map((k) => (filter as any)[k]))
}

export function channelConfigEnc(db: DatabaseSync, id: string): Uint8Array {
  const r = db.prepare('SELECT config_enc FROM channels WHERE id = ?').get(id) as any
  return r.config_enc as Uint8Array
}
```

- [ ] **Step 2: Write `web/e2e/fixtures.ts`**

```ts
import { test as base, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const APP_SECRET = 'e2e-app-secret-0123456789'
export const ADMIN = 'admin@local.test'
export const MEMBER_A = 'member-a@local.test'
export const MEMBER_B = 'member-b@local.test'

export type App = {
  baseUrl: string
  dataDir: string
  dbPath: string
  db: DatabaseSync
  logPath: string
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function startApp(): Promise<App> {
  const workerIndex = process.env.TEST_PARALLEL_INDEX ?? '0'
  const dataDir = await mkdtemp(path.join(os.tmpdir(), `wimember-e2e-${process.pid}-${workerIndex}-`))
  const dbPath = path.join(dataDir, 'wimember.db')
  const logPath = path.join(dataDir, 'server.log')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const bin = fileURLToPath(new URL('../../bin/wimember', import.meta.url)) // ESM-safe: no __dirname under type:module

  const logStream = createWriteStream(logPath)
  const child: ChildProcessWithoutNullStreams = spawn(bin, [], {
    env: {
      ...process.env,
      ADDR: `127.0.0.1:${port}`,
      DATA_DIR: dataDir,
      AUTH_MODE: 'dev',
      APP_SECRET,
      ADMIN_EMAILS: ADMIN,
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e] server exited with code ${code} — log: ${logPath}`)
    }
  })

  let up = false
  for (let i = 0; i < 150 && !up; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`)
      up = res.ok
    } catch {
      await sleep(200)
    }
  }
  if (!up) {
    throw new Error(`server did not become healthy on ${baseUrl} — see ${logPath}`)
  }

  return { baseUrl, dataDir, dbPath, db: new DatabaseSync(dbPath), logPath }
}

async function stopApp(app: App) {
  app.db.close()
  if (process.env.E2E_KEEP_DATA === '1') {
    console.log(`E2E_KEEP_DATA=1 — keeping ${app.dataDir} (server log: ${app.logPath})`)
    return
  }
  await rm(app.dataDir, { recursive: true, force: true })
}

export const test = base.extend<{ app: App }, { app: App }>({
  app: [
    async ({}, use) => {
      const app = await startApp()
      await use(app)
      await stopApp(app)
    },
    { scope: 'worker', timeout: 120_000 },
  ],
})

export { expect }
```

- [ ] **Step 3: Write `web/e2e/smoke.spec.ts`**

```ts
import { test, expect } from './fixtures'
import { rows } from './helpers/db'

test('healthz responds ok', async ({ app }) => {
  const res = await fetch(`${app.baseUrl}/healthz`)
  expect(res.status()).toBe(200)
  await expect(res.json()).resolves.toEqual({ ok: true })
})

test('serves the embedded SPA on / and on deep links', async ({ app }) => {
  for (const p of ['/', '/reminder/contacts']) {
    const res = await fetch(`${app.baseUrl}${p}`)
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain('<div id="root"')
  }
})

test('migrations created the full schema', async ({ app }) => {
  const tables = rows(app.db, `SELECT name FROM sqlite_master WHERE type = 'table'`).map((r) => r.name)
  for (const t of [
    'users', 'contacts', 'occasions', 'reminder_prefs', 'occasion_prefs',
    'channels', 'notification_log', 'settings', 'holiday_cache', 'schema_migrations',
  ]) {
    expect(tables, `table ${t}`).toContain(t)
  }
})

test('parallel workers get isolated databases', async ({ app }) => {
  // Each worker's DATA_DIR is unique; prove this worker's file exists and is empty of users.
  const { stat } = await import('node:fs/promises')
  const s = await stat(app.dbPath)
  expect(s.size).toBeGreaterThan(0)
  expect(rows(app.db, 'SELECT COUNT(*) AS n FROM users')[0].n).toBe(0)
})
```

- [ ] **Step 4: Run**

Run: `make build && cd web && pnpm exec playwright test e2e/smoke.spec.ts`
Expected: 4 passed. On failure, the error message points at `server.log` inside the temp DATA_DIR; rerun with `E2E_KEEP_DATA=1` to inspect.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/fixtures.ts web/e2e/helpers/db.ts web/e2e/smoke.spec.ts
git commit -m "test(web): per-worker app fixture (real server, fresh sqlite) + smoke"
```

---

### Task 3: `session` fixture, Gotify stub, seed/time/crypto helpers, auth spec

**Files:**
- Modify: `web/e2e/fixtures.ts` (add `session` + stub)
- Create: `web/e2e/helpers/crypto.ts`
- Create: `web/e2e/helpers/seed.ts`
- Create: `web/e2e/helpers/time.ts`
- Create: `web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `app` fixture, `APP_SECRET`, `ADMIN`, `MEMBER_A`, `MEMBER_B` (Task 2).
- Produces:
  - `App` gains `stubUrl: string` and `stubMessages(): { title: string; message: string; priority: number; token: string }[]`
  - Test-scoped fixture `session: { pageAs(email?: string, opts?: BrowserContextOptions): Promise<Page>; apiAs(email?: string): Promise<APIRequestContext> }` (contexts cached per email; `baseURL` = app, `X-Dev-Email` header set, localStorage pre-seeded)
  - `helpers/crypto.ts`: `decryptConfig(appSecret: string, blob: Uint8Array): string` (returns plaintext JSON)
  - `helpers/seed.ts`: `uniq(prefix: string): string`; `seedContact(request, { name, nickname?, notes? }): Promise<string>`; `seedOccasion(request, contactId, { type, date, recurrence, label? }): Promise<string>`; `seedChannel(request, { type, name, config }): Promise<string>`; `putSettings(request, settings): Promise<void>`; `runScheduler(request): Promise<{ sent: number; failed: number; missed: number }>`
  - `helpers/time.ts`: `utcToday(): string` (YYYY-MM-DD); `utcDaysFromToday(days: number): string`; `dueSettings(opts?: { catchUpHours?: number }): SettingsPayload`; `futureSettings(): SettingsPayload`
  - `SettingsPayload` type exported from `helpers/seed.ts`

- [ ] **Step 1: Replace `web/e2e/fixtures.ts` with the complete final version** (adds the Gotify stub to the worker-scoped `app` and the test-scoped `session`)

```ts
import { test as base, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { APIRequestContext, BrowserContext, BrowserContextOptions, Page } from '@playwright/test'

export const APP_SECRET = 'e2e-app-secret-0123456789'
export const ADMIN = 'admin@local.test'
export const MEMBER_A = 'member-a@local.test'
export const MEMBER_B = 'member-b@local.test'

export type StubMessage = { title: string; message: string; priority: number; token: string }

export type App = {
  baseUrl: string
  dataDir: string
  dbPath: string
  db: DatabaseSync
  logPath: string
  stubUrl: string
  stubMessages: () => StubMessage[]
  stubServer: Server
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function startGotifyStub(): Promise<{ server: Server; url: string; messages: () => StubMessage[] }> {
  return new Promise((resolve) => {
    const received: StubMessage[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        if (req.method === 'POST') {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? ''
            received.push({ title: body.title, message: body.message, priority: body.priority, token })
          } catch { /* not JSON — ignore */ }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"id":1}')
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, messages: () => [...received] })
    })
  })
}

async function startApp(): Promise<App> {
  const workerIndex = process.env.TEST_PARALLEL_INDEX ?? '0'
  const dataDir = await mkdtemp(path.join(os.tmpdir(), `wimember-e2e-${process.pid}-${workerIndex}-`))
  const dbPath = path.join(dataDir, 'wimember.db')
  const logPath = path.join(dataDir, 'server.log')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const bin = fileURLToPath(new URL('../../bin/wimember', import.meta.url))

  const logStream = createWriteStream(logPath)
  const child: ChildProcessWithoutNullStreams = spawn(bin, [], {
    env: {
      ...process.env,
      ADDR: `127.0.0.1:${port}`,
      DATA_DIR: dataDir,
      AUTH_MODE: 'dev',
      APP_SECRET,
      ADMIN_EMAILS: ADMIN,
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e] server exited with code ${code} — log: ${logPath}`)
    }
  })

  let up = false
  for (let i = 0; i < 150 && !up; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`)
      up = res.ok
    } catch {
      await sleep(200)
    }
  }
  if (!up) {
    throw new Error(`server did not become healthy on ${baseUrl} — see ${logPath}`)
  }

  const stub = await startGotifyStub()
  return {
    baseUrl, dataDir, dbPath, logPath,
    db: new DatabaseSync(dbPath),
    stubUrl: stub.url, stubMessages: stub.messages, stubServer: stub.server,
  }
}

async function stopApp(app: App) {
  app.db.close()
  app.stubServer.close()
  if (process.env.E2E_KEEP_DATA === '1') {
    console.log(`E2E_KEEP_DATA=1 — keeping ${app.dataDir} (server log: ${app.logPath})`)
    return
  }
  await rm(app.dataDir, { recursive: true, force: true })
}

type Session = {
  pageAs(email?: string, opts?: BrowserContextOptions): Promise<Page>
  apiAs(email?: string): Promise<APIRequestContext>
}

export const test = base.extend<{ app: App; session: Session }, { app: App }>({
  app: [
    async ({}, use) => {
      const app = await startApp()
      await use(app)
      await stopApp(app)
    },
    { scope: 'worker', timeout: 120_000 },
  ],

  session: async ({ app, browser }, use) => {
    const cache = new Map<string, BrowserContext>()
    const ctxFor = async (email: string, opts?: BrowserContextOptions) => {
      const hit = cache.get(email)
      if (hit && !opts) return hit
      if (hit) await hit.close()
      const ctx = await browser.newContext({
        ...opts,
        baseURL: app.baseUrl,
        extraHTTPHeaders: { 'X-Dev-Email': email },
      })
      await ctx.addInitScript(
        (email: string) => localStorage.setItem('wimember-dev-email', email),
        email,
      )
      cache.set(email, ctx)
      return ctx
    }
    await use({
      pageAs: async (email = MEMBER_A, opts) => (await ctxFor(email, opts)).newPage(),
      apiAs: async (email = MEMBER_A) => (await ctxFor(email)).request,
    })
    for (const c of cache.values()) await c.close()
  },
})

export { expect }
```

- [ ] **Step 2: Write `web/e2e/helpers/crypto.ts`**

```ts
import { createDecipheriv, createHash } from 'node:crypto'

/** Mirror of internal/secret: key = sha256(APP_SECRET), blob = nonce(12) ‖ ct ‖ tag(16). */
export function decryptConfig(appSecret: string, blob: Uint8Array): string {
  const key = createHash('sha256').update(appSecret).digest()
  const buf = Buffer.from(blob)
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8')
}
```

- [ ] **Step 3: Write `web/e2e/helpers/time.ts`**

```ts
export type SettingsPayload = {
  timezone: string
  send_time: string
  catch_up_hours: number
  default_offsets: number[]
  default_channel_ids: string[] | null
  holiday_categories: Record<string, boolean>
  holiday_offsets: Record<string, number[]>
  recurrence_offsets: Record<string, number[]>
}

const hm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function utcDaysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** Deterministic "due now": occasion dated TODAY is past its send time.
 *  send_time = now−2min; if that crossed midnight UTC, fall back to 00:00
 *  (today@00:00 is always in the past, and ≤2 min late so no "late" flag). */
export function dueSettings(opts: { catchUpHours?: number } = {}): SettingsPayload {
  const now = new Date()
  const minus2 = new Date(now.getTime() - 2 * 60_000)
  const sameDay = minus2.getUTCDate() === now.getUTCDate()
  return baseSettings(sameDay ? hm(minus2) : '00:00', opts.catchUpHours ?? 24)
}

/** Deterministic "not yet due": pair with an occasion dated TOMORROW. */
export function futureSettings(): SettingsPayload {
  return baseSettings(hm(new Date(Date.now() + 30 * 60_000)), 24)
}

function baseSettings(sendTime: string, catchUpHours: number): SettingsPayload {
  return {
    timezone: 'UTC',
    send_time: sendTime,
    catch_up_hours: catchUpHours,
    default_offsets: [0],
    default_channel_ids: null,
    holiday_categories: { pawukon: false, saka: false, national: false },
    holiday_offsets: {},
    recurrence_offsets: { event: [0], yearly: [0], monthly: [0], otonan: [0] },
  }
}
```

- [ ] **Step 4: Write `web/e2e/helpers/seed.ts`**

```ts
import { expect, type APIRequestContext } from '@playwright/test'
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
```

- [ ] **Step 5: Write `web/e2e/auth.spec.ts`**

```ts
import { test, expect, ADMIN, MEMBER_A } from './fixtures'
import { rows } from './helpers/db'

test('API rejects requests without a dev email (401)', async ({ app }) => {
  const res = await fetch(`${app.baseUrl}/api/v1/me`)
  expect(res.status()).toBe(401)
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
```

- [ ] **Step 6: Run**

Run: `cd web && pnpm exec playwright test e2e/auth.spec.ts`
Expected: 5 passed. If the prompt-flow test is flaky on toasts/queries, ensure the dialog handler is registered before `goto` (it is).

- [ ] **Step 7: Commit**

```bash
git add web/e2e/fixtures.ts web/e2e/helpers/crypto.ts web/e2e/helpers/seed.ts web/e2e/helpers/time.ts web/e2e/auth.spec.ts
git commit -m "test(web): session/gotify-stub fixtures, seed+time helpers, auth e2e"
```

---

### Task 4: Contacts spec

**Files:**
- Create: `web/e2e/contacts.spec.ts`

**Interfaces:**
- Consumes: `app`, `session`, `MEMBER_A`, `MEMBER_B`, `ADMIN`; `uniq`, `seedContact`, `seedOccasion`; `rowById`, `count`, `rows`.
- UI contract used (verified in codebase): create form fields `#contact-name`, `#contact-nickname`, `#contact-notes`; page-variant submit button `Create contact` (disabled until name non-empty AND dirty); docked panel variant at `/reminder/contacts?c=new` with same fields; grid row name text; row kebab `Actions for {name}` with `Open`/`Delete`; detail summary kebab `More actions` → `Edit` opens the edit overlay; delete dialog title `Delete {name}?` with `Cancel`/`Delete` buttons; toasts `Contact created` / `Contact updated` / `Contact deleted`; search input placeholder `Search name or nickname…`; not-found page shows `404` + `Page not found`.

- [ ] **Step 1: Write `web/e2e/contacts.spec.ts`**

```ts
import { test, expect, MEMBER_A, MEMBER_B, ADMIN } from './fixtures'
import { count, rowById } from './helpers/db'
import { putSettings, seedContact, seedOccasion, uniq } from './helpers/seed'

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
  await api.put(`/api/v1/contacts/${id}/prefs`, { data: { offsets: { yearly: [7, 0] } } })

  const page = await session.pageAs()
  await page.goto('/reminder/contacts')
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
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
  await expect(page.getByText(a)).toBeVisible()
  await page.getByPlaceholder('Search name or nickname…').fill('Alpha Wayan'.slice(0, 12))
  await expect(page.getByText(a).first()).toBeVisible()
  await expect(page.getByText(b)).toHaveCount(0)
})

test('bogus deep-link shows the not-found page, not a crash', async ({ session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/contacts/not-a-uuid')
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
  await expect(bPage.getByText(name)).toHaveCount(0)

  const adminPage = await session.pageAs(ADMIN)
  await adminPage.goto('/reminder/contacts')
  await expect(adminPage.getByText(name).first()).toBeVisible()

  const ownerRow = app.db.prepare('SELECT id FROM users WHERE email = ?', MEMBER_A).get() as any
  expect(rowById(app.db, 'contacts', id).owner_id).toBe(ownerRow.id)
})
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/contacts.spec.ts`
Expected: 9 passed.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/contacts.spec.ts
git commit -m "test(web): contacts e2e — crud, cascade, search, scoping, 404"
```

---

### Task 5: Occasions spec

**Files:**
- Create: `web/e2e/occasions.spec.ts`

**Interfaces:**
- Consumes: fixtures + `seedContact`; `rowById`, `count`.
- UI contract: contact detail at `/reminder/contacts/{id}` with tabs `Occasions` / `Reminder Preferences`; `Add occasion` button opens the dialog; type select `#occ-type` options `Otonan (210-day Pawukon)` / `Birthday` / `Anniversary` / `Custom…` (custom reveals `#occ-custom`); recurrence select `#occ-recurrence` options `One-time` / `Every year` / `Every month` / `Every year + every month` / `Otonan (every 210 days)`; date picker: click the button containing `Pick a date`, then fill the popover textbox with `DD/MM/YYYY` (commits + closes); `#occ-label`; submit `Add occasion` / `Save changes`; edit dialog title `Edit {type}`; delete dialog `Delete this occasion?`; Feb-29 hint text `Feb 29 in non-leap years is observed on March 1.`; per-occasion prefs live in the row's accordion: expand via `Toggle {type} details`, then switch `Use custom reminders` and input `#occ-{occasionId}-offsets` (placeholder `inherit`).

- [ ] **Step 1: Write `web/e2e/occasions.spec.ts`**

```ts
import { test, expect } from './fixtures'
import { count, rowById } from './helpers/db'
import { seedContact, uniq } from './helpers/seed'

/** Pick a date in the occasion dialog: open the popover, type DD/MM/YYYY (commits). */
async function pickDate(page: import('@playwright/test').Page, ddmmyyyy: string) {
  await page.getByRole('button', { name: 'Pick a date' }).click()
  const pop = page.getByRole('dialog').last()
  await pop.getByRole('textbox').fill(ddmmyyyy)
  await expect(pop).toBeHidden()
}

async function openAddDialog(page: import('@playwright/test').Page) {
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

  const occ = app.db.prepare(
    'SELECT * FROM occasions WHERE contact_id = ? AND type = ?', contactId, 'birthday',
  ).get() as any
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

  const occ = app.db.prepare(
    'SELECT * FROM occasions WHERE contact_id = ? AND type = ?', contactId, 'graduation',
  ).get() as any
  expect(occ).toMatchObject({ recurrence: 'once', base_date: '2025-08-15' })
})

test('edits an occasion label via the Edit dialog', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Edit Occ') })
  const occId = (await (await session.apiAs())
    .post(`/api/v1/contacts/${contactId}/occasions`, {
      data: { type: 'wedding', date: '2020-05-10', recurrence: 'yearly', label: 'Wedding day' },
    })).json() as { id: string }

  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)
  await page.getByRole('button', { name: 'More actions for wedding' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await page.locator('#occ-label').fill('Anniversary luncheon')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Occasion updated')).toBeVisible()

  expect(rowById(app.db, 'occasions', occId).label).toBe('Anniversary luncheon')
})

test('deletes an occasion after confirm', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Del Occ') })
  const occId = (await (await session.apiAs())
    .post(`/api/v1/contacts/${contactId}/occasions`, {
      data: { type: 'otonan', date: '2000-01-01', recurrence: 'otonan' },
    })).json() as { id: string }

  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)
  await page.getByRole('button', { name: 'More actions for otonan' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()

  expect(count(app.db, 'occasions', { id: occId })).toBe(0)
})

test('per-occasion custom prefs write occasion_prefs (custom=1) and reset deletes the row', async ({ app, session }) => {
  const contactId = await seedContact(await session.apiAs(), { name: uniq('Occ Prefs') })
  const api = await session.apiAs()
  const occ = (await api.post(`/api/v1/contacts/${contactId}/occasions`, {
    data: { type: 'birthday', date: '1995-12-24', recurrence: 'yearly' },
  })).json() as { id: string }

  const page = await session.pageAs()
  await page.goto(`/reminder/contacts/${contactId}`)
  await page.getByRole('button', { name: 'Toggle birthday details' }).click()
  await page.getByRole('switch', { name: 'Use custom reminders' }).click()
  await page.locator(`#occ-${occ.id}-offsets`).fill('10, 5, 0')
  await page.locator(`#occ-${occ.id}-offsets`).blur()

  await expect
    .poll(() => count(app.db, 'occasion_prefs', { occasion_id: occ.id }))
    .toBe(1)
  // occasion_prefs is keyed by occasion_id (PK), not id — read it directly.
  const prefs = app.db
    .prepare('SELECT * FROM occasion_prefs WHERE occasion_id = ?', occ.id)
    .get() as any
  expect(prefs).toMatchObject({ custom: 1, enabled: 1 })
  expect(JSON.parse(prefs.offsets)).toEqual({ yearly: [10, 5, 0] })

  await page.getByRole('switch', { name: 'Use custom reminders' }).click()
  await expect
    .poll(() => count(app.db, 'occasion_prefs', { occasion_id: occ.id }))
    .toBe(0)
})
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/occasions.spec.ts`
Expected: 5 passed. If the accordion toggle's accessible name differs (e.g. includes the type's label text), adjust the `Toggle … details` locator to `/Toggle .* details/` — the aria-label is `Toggle {o.type} details`.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/occasions.spec.ts
git commit -m "test(web): occasions e2e — add/edit/delete, custom types, feb29, per-occasion prefs"
```

---

### Task 6: Channels spec (encryption + stub test-send)

**Files:**
- Create: `web/e2e/channels.spec.ts`

**Interfaces:**
- Consumes: fixtures (incl. `app.stubUrl`, `app.stubMessages()`), `APP_SECRET`; `channelConfigEnc`, `settingsJson`, `rowById`, `count`; `uniq`.
- UI contract: `/reminder/channels`; `Add channel` button opens the dialog; `#ch-type` select (Gotify/Telegram/Email); `#ch-name`; per-type `#ch-cfg-base_url`/`#ch-cfg-token`, `#ch-cfg-bot_token`/`#ch-cfg-chat_id`, `#ch-cfg-host`/`#ch-cfg-port`/`#ch-cfg-username`/`#ch-cfg-password`/`#ch-cfg-from`/`#ch-cfg-to`; submit `Add channel` (disabled with empty name); toasts `Channel created`, `Test succeeded — notification sent.`, `Test failed: …`; row switches `#ch-active-{id}` (`Toggle channel active`) and `#ch-default-{id}` (`Set as default channel`); `Test {name}` button; kebab `More actions for {name}` → Delete → dialog `Delete channel {name}?`; channels are owner-scoped.

- [ ] **Step 1: Write `web/e2e/channels.spec.ts`**

```ts
import { test, expect, APP_SECRET, MEMBER_A, MEMBER_B } from './fixtures'
import { channelConfigEnc, count, rowById, settingsJson } from './helpers/db'
import { decryptConfig } from './helpers/crypto'
import { uniq } from './helpers/seed'

async function openAddDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add channel' }).first().click()
  await expect(page.getByRole('dialog').last()).toBeVisible()
}

async function addGotify(page: import('@playwright/test').Page, app: import('./fixtures').App, name: string) {
  await openAddDialog(page)
  await page.locator('#ch-name').fill(name)
  await page.locator('#ch-cfg-base_url').fill(app.stubUrl)
  await page.locator('#ch-cfg-token').fill('stub-token-xyz')
  await page.getByRole('button', { name: 'Add channel' }).click()
  await expect(page.getByText('Channel created')).toBeVisible()
}

test('adds a gotify channel; config stored encrypted and decrypts exactly', async ({ app, session }) => {
  const name = uniq('gotify-stub')
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)

  const ch = app.db.prepare('SELECT * FROM channels WHERE name = ?', name).get() as any
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

  await openAddDialog(page)
  await page.locator('#ch-type').click()
  await page.getByRole('option', { name: 'Telegram' }).click()
  await page.locator('#ch-name').fill(uniq('tg-real-shaped'))
  await page.locator('#ch-cfg-bot_token').fill('123456:ABC-def_GHI')
  await page.locator('#ch-cfg-chat_id').fill('-100200300')
  await page.getByRole('button', { name: 'Add channel' }).click()
  await expect(page.getByText('Channel created')).toBeVisible()

  await openAddDialog(page)
  await page.locator('#ch-type').click()
  await page.getByRole('option', { name: 'Email' }).click()
  const deadName = uniq('email-dead')
  await page.locator('#ch-name').fill(deadName)
  await page.locator('#ch-cfg-host').fill('127.0.0.1')
  await page.locator('#ch-cfg-port').fill('9')
  await page.locator('#ch-cfg-username').fill('u')
  await page.locator('#ch-cfg-password').fill('p')
  await page.locator('#ch-cfg-from').fill('from@local.test')
  await page.locator('#ch-cfg-to').fill('to@local.test')
  await page.getByRole('button', { name: 'Add channel' }).click()
  await expect(page.getByText('Channel created', { exact: false })).toBeVisible()

  const tg = app.db.prepare(`SELECT * FROM channels WHERE type = 'telegram'`).get() as any
  expect(JSON.parse(decryptConfig(APP_SECRET, channelConfigEnc(app.db, tg.id)))).toEqual({
    bot_token: '123456:ABC-def_GHI', chat_id: '-100200300',
  })
  const mail = app.db.prepare(`SELECT * FROM channels WHERE type = 'email'`).get() as any
  expect(JSON.parse(decryptConfig(APP_SECRET, channelConfigEnc(app.db, mail.id)))).toMatchObject({
    host: '127.0.0.1', port: 9, from: 'from@local.test', to: 'to@local.test',
  })
})

test('Add channel stays disabled with an empty name; server rejects bad config', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await openAddDialog(page)
  await expect(page.getByRole('button', { name: 'Add channel' })).toBeDisabled()

  const res = await (await session.apiAs()).post('/api/v1/channels', {
    data: { type: 'gotify', name: 'bad-config', config: { token: 'x' } },
  })
  expect(res.status()).toBe(400) // missing base_url
})

test('enable/disable toggle persists to the DB', async ({ app, session }) => {
  const name = uniq('gotify-toggle')
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)
  const id = (app.db.prepare('SELECT id FROM channels WHERE name = ?', name).get() as any).id

  await page.locator(`#ch-active-${id}`).click()
  await expect.poll(() => rowById(app.db, 'channels', id).enabled).toBe(0)
  await page.locator(`#ch-active-${id}`).click()
  await expect.poll(() => rowById(app.db, 'channels', id).enabled).toBe(1)
})

test('Set as default writes default_channel_ids into the settings blob', async ({ app, session }) => {
  const name = uniq('gotify-default')
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)
  const id = (app.db.prepare('SELECT id FROM channels WHERE name = ?', name).get() as any).id

  await page.locator(`#ch-default-${id}`).click()
  await expect.poll(() => settingsJson(app.db)?.default_channel_ids).toContain(id)
})

test('Test send: success pushes to the stub; failure toasts and pushes nothing', async ({ app, session }) => {
  const page = await session.pageAs()
  await page.goto('/reminder/channels')
  const okName = uniq('gotify-test-ok')
  await addGotify(page, app, okName)
  await page.getByRole('button', { name: `Test ${okName}` }).click()
  await expect(page.getByText('Test succeeded — notification sent.')).toBeVisible()
  expect(app.stubMessages().some((m) => m.title === 'wimember tes')).toBe(true)
  expect(app.stubMessages().some((m) => m.token === 'stub-token-xyz')).toBe(true)

  const deadName = uniq('email-test-dead')
  await openAddDialog(page)
  await page.locator('#ch-type').click()
  await page.getByRole('option', { name: 'Email' }).click()
  await page.locator('#ch-name').fill(deadName)
  await page.locator('#ch-cfg-host').fill('127.0.0.1')
  await page.locator('#ch-cfg-port').fill('9')
  await page.locator('#ch-cfg-username').fill('u')
  await page.locator('#ch-cfg-password').fill('p')
  await page.locator('#ch-cfg-from').fill('from@local.test')
  await page.locator('#ch-cfg-to').fill('to@local.test')
  await page.getByRole('button', { name: 'Add channel' }).click()
  await expect(page.getByText('Channel created', { exact: false })).toBeVisible()

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
  const id = (app.db.prepare('SELECT id FROM channels WHERE name = ?', name).get() as any).id

  await page.getByRole('button', { name: `More actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => count(app.db, 'channels', { id })).toBe(0)
})

test('channels are owner-scoped', async ({ app, session }) => {
  const name = uniq('gotify-scoped')
  const page = await session.pageAs(MEMBER_A)
  await page.goto('/reminder/channels')
  await addGotify(page, app, name)

  const bPage = await session.pageAs(MEMBER_B)
  await bPage.goto('/reminder/channels')
  await expect(bPage.getByText(name)).toHaveCount(0)
  const bList = await (await (await session.apiAs(MEMBER_B)).get('/api/v1/channels')).json()
  expect((bList.channels as any[]).some((c) => c.name === name)).toBe(false)
})
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/channels.spec.ts`
Expected: 7 passed. If `#ch-active-{id}` does not receive the click (hidden input), click `page.getByRole('switch', { name: 'Toggle channel active' })` scoped to the row via `page.locator('li,div', { hasText: name }).getByRole(...)`.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/channels.spec.ts
git commit -m "test(web): channels e2e — encryption round-trip, toggles, default, test-send, scoping"
```

---

### Task 7: Settings spec

**Files:**
- Create: `web/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: fixtures; `settingsJson`.
- UI contract: `/reminder/settings`; tabs `General` / `Holidays` / `Recurrence`; General: `#send-time`, `#catch-up`, `#offsets`, timezone select (trigger shows `Select a timezone` or the stored zone; options include `Asia/Jakarta` and `UTC` under `Other timezones`); Holidays: switches `Toggle {label} holiday reminders` with labels `Pawukon holidays (computed locally)`, `Balinese & Saka holidays (API)`, `National holidays (API)`; Recurrence: inputs `#rec-offsets-event`, `#rec-offsets-yearly`, `#rec-offsets-monthly`, `#rec-offsets-otonan` — **Save is disabled while any stream is empty**; footer `Save` button; toast `Saved.` on success, `Failed to save: …` on 400.

- [ ] **Step 1: Write `web/e2e/settings.spec.ts`**

```ts
import { test, expect } from './fixtures'
import { settingsJson } from './helpers/db'

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
  await page.getByRole('switch', { name: /Toggle Pawukon holidays/ }).click()
  await page.getByRole('switch', { name: /Toggle National holidays/ }).click()
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
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/settings.spec.ts`
Expected: 6 passed. Watch the timezone trigger locator — if `getByRole('combobox')` matches multiple, scope to the General tab pane.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/settings.spec.ts
git commit -m "test(web): settings e2e — blob round-trip, holiday toggles, validation"
```

---

### Task 8: Upcoming spec (agenda, Remind Now, range validation, Feb 29 / otonan)

**Files:**
- Create: `web/e2e/upcoming.spec.ts`

**Interfaces:**
- Consumes: fixtures + `seedContact`, `seedOccasion`, `seedChannel`, `putSettings`; `notificationLog`; `utcToday`, `utcDaysFromToday`.
- UI contract: `/reminder` agenda panel lists upcoming items as buttons whose accessible name contains the item title and contact name; clicking opens the event detail (panel on lg / dialog below lg) which contains a `Remind Now` button (single enabled channel) or a `Remind Now` dropdown (multi). Toast: `Reminder sent to 1 channel.`

- [ ] **Step 1: Write `web/e2e/upcoming.spec.ts`**

```ts
import { test, expect } from './fixtures'
import { notificationLog } from './helpers/db'
import { seedChannel, seedContact, seedOccasion, uniq } from './helpers/seed'
import { utcDaysFromToday, utcToday } from './helpers/time'

test('agenda lists a birthday due today and an event due tomorrow', async ({ session }) => {
  const api = await session.apiAs()
  const name = uniq('Agenda Made')
  const contactId = await seedContact(api, { name })
  await seedOccasion(api, contactId, { type: 'birthday', date: utcToday(), recurrence: 'yearly' })
  await seedOccasion(api, contactId, { type: 'wedding', date: utcDaysFromToday(1), recurrence: 'once' })

  const page = await session.pageAs()
  await page.goto('/reminder')
  await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible()

  const res = await api.get('/api/v1/upcoming?days=3')
  const { items } = await res.json()
  const birthday = items.find((i: any) => i.type === 'birthday' && i.contact_name === name)
  expect(birthday).toMatchObject({ kind: 'occasion', days_until: 0 })
})

test('Remind Now sends via the stub but never writes notification_log', async ({ app, session }) => {
  const api = await session.apiAs()
  const name = uniq('Remind Komang')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcToday(), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('stub-gotify'), config: { base_url: app.stubUrl, token: 'stub-token-xyz' } })

  const page = await session.pageAs()
  await page.goto('/reminder')
  await page.getByRole('button', { name: new RegExp(name) }).first().click()
  await page.getByRole('button', { name: 'Remind Now' }).first().click()
  await expect(page.getByText('Reminder sent to 1 channel.')).toBeVisible()

  const msgs = app.stubMessages()
  expect(msgs.length).toBe(1)
  expect(msgs[0].title).toContain(name)
  expect(notificationLog(app.db, { occasion_id: occId })).toHaveLength(0)
})

test('otonan lands today for a base date 210 days ago', async ({ app, session }) => {
  const api = await session.apiAs()
  const name = uniq('Otonan Wayan')
  const contactId = await seedContact(api, { name })
  await seedOccasion(api, contactId, {
    type: 'otonan', date: utcDaysFromToday(-210), recurrence: 'otonan',
  })
  const { items } = await (await api.get('/api/v1/upcoming?days=2')).json()
  const oto = items.find((i: any) => i.type === 'otonan' && i.contact_name === name)
  expect(oto).toMatchObject({ kind: 'occasion', date: utcToday(), days_until: 0 })
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
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/upcoming.spec.ts`
Expected: 5 passed. The `days=500` response items may be empty — only the status is asserted.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/upcoming.spec.ts
git commit -m "test(web): upcoming e2e — agenda, remind-now (unlogged), otonan-210, feb29, range 400s"
```

---

### Task 9: Scheduler spec (dedupe, per-channel, failed, missed, future, 403)

**Files:**
- Create: `web/e2e/scheduler.spec.ts`

**Interfaces:**
- Consumes: fixtures (`ADMIN`, `MEMBER_A`, stub); `notificationLog`, `rowById`; `seedContact`, `seedOccasion`, `seedChannel`, `putSettings`, `runScheduler`, `uniq`; `dueSettings`, `futureSettings`, `utcToday`, `utcDaysFromToday`.
- Backend contract: scheduler sends to the contact **owner's** channels; failed sends are NOT recorded in `notification_log` (retryable, 15-min in-memory backoff); occurrences older than the catch-up window get one `missed` row per channel; `POST /api/v1/scheduler/run` is admin-only (403 member).

- [ ] **Step 1: Write `web/e2e/scheduler.spec.ts`**

```ts
import { test, expect, ADMIN, MEMBER_A } from './fixtures'
import { notificationLog } from './helpers/db'
import { putSettings, runScheduler, seedChannel, seedContact, seedOccasion, uniq } from './helpers/seed'
import { dueSettings, futureSettings, utcDaysFromToday, utcToday } from './helpers/time'

test('sends a due occasion: stub receipt + sent log row', async ({ app, session }) => {
  const api = await session.apiAs(ADMIN)
  await putSettings(api, dueSettings())
  const name = uniq('Sched Made')
  const contactId = await seedContact(api, { name })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcToday(), recurrence: 'yearly' })
  const chId = await seedChannel(api, { type: 'gotify', name: uniq('sched-gotify'), config: { base_url: app.stubUrl, token: 'tok-1' } })

  const res = await runScheduler(api)
  expect(res).toEqual({ sent: 1, failed: 0, missed: 0 })

  const msgs = app.stubMessages()
  expect(msgs).toHaveLength(1)
  expect(msgs[0].title).toContain(name)
  expect(msgs[0].message).toContain(`for ${name}`)

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(1)
  expect(log[0]).toMatchObject({ status: 'sent', offset_days: 0, channel_id: chId })
  expect(String(log[0].occurrence_date)).toContain(utcToday()) // serialized either as date or text
})

test('rerun dedupes: second run sends 0 and adds no rows', async ({ app, session }) => {
  const api = await session.apiAs(ADMIN)
  await putSettings(api, dueSettings())
  const contactId = await seedContact(api, { name: uniq('Dedupe') })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcToday(), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('dedupe-gotify'), config: { base_url: app.stubUrl, token: 'tok-2' } })

  await runScheduler(api)
  const second = await runScheduler(api)
  expect(second).toEqual({ sent: 0, failed: 0, missed: 0 })

  expect(notificationLog(app.db, { occasion_id: occId })).toHaveLength(1)
  expect(app.stubMessages()).toHaveLength(1)
})

test('two enabled channels → one log row per channel, stub gets both', async ({ app, session }) => {
  const api = await session.apiAs(ADMIN)
  await putSettings(api, dueSettings())
  const contactId = await seedContact(api, { name: uniq('Two Ch') })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcToday(), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('ch-a'), config: { base_url: app.stubUrl, token: 'tok-a' } })
  await seedChannel(api, { type: 'gotify', name: uniq('ch-b'), config: { base_url: app.stubUrl, token: 'tok-b' } })

  const res = await runScheduler(api)
  expect(res).toEqual({ sent: 2, failed: 0, missed: 0 })

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(2)
  expect(new Set(log.map((r) => r.channel_id)).size).toBe(2)
  expect(app.stubMessages().map((m) => m.token).sort()).toEqual(['tok-a', 'tok-b'])
})

test('dead email channel fails without a log row; the healthy channel still sends', async ({ app, session }) => {
  const api = await session.apiAs(ADMIN)
  await putSettings(api, dueSettings())
  const contactId = await seedContact(api, { name: uniq('Fail Ch') })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcToday(), recurrence: 'yearly' })
  const okId = await seedChannel(api, { type: 'gotify', name: uniq('ok-gotify'), config: { base_url: app.stubUrl, token: 'tok-ok' } })
  const deadId = await seedChannel(api, {
    type: 'email', name: uniq('dead-mail'),
    config: { host: '127.0.0.1', port: 9, username: 'u', password: 'p', from: 'f@local.test', to: 't@local.test' },
  })

  const res = await runScheduler(api)
  expect(res.sent).toBe(1)
  expect(res.failed).toBe(1)

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(1)
  expect(log[0].channel_id).toBe(okId)
  expect(notificationLog(app.db, { channel_id: deadId })).toHaveLength(0)
})

test('occurrence beyond the catch-up window is recorded missed, not sent', async ({ app, session }) => {
  const api = await session.apiAs(ADMIN)
  await putSettings(api, dueSettings({ catchUpHours: 1 }))
  const contactId = await seedContact(api, { name: uniq('Missed') })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcDaysFromToday(-2), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('missed-gotify'), config: { base_url: app.stubUrl, token: 'tok-m' } })

  const res = await runScheduler(api)
  expect(res.missed).toBeGreaterThanOrEqual(1)
  expect(res.sent).toBe(0)
  expect(app.stubMessages()).toHaveLength(0)

  const log = notificationLog(app.db, { occasion_id: occId })
  expect(log).toHaveLength(1)
  expect(log[0].status).toBe('missed')
})

test('future send_time: nothing due, nothing logged', async ({ app, session }) => {
  const api = await session.apiAs(ADMIN)
  await putSettings(api, futureSettings())
  const contactId = await seedContact(api, { name: uniq('Future') })
  const occId = await seedOccasion(api, contactId, { type: 'birthday', date: utcDaysFromToday(1), recurrence: 'yearly' })
  await seedChannel(api, { type: 'gotify', name: uniq('future-gotify'), config: { base_url: app.stubUrl, token: 'tok-f' } })

  const res = await runScheduler(api)
  expect(res).toEqual({ sent: 0, failed: 0, missed: 0 })
  expect(notificationLog(app.db, { occasion_id: occId })).toHaveLength(0)
  expect(app.stubMessages()).toHaveLength(0)
})

test('scheduler run is admin-only', async ({ session }) => {
  const res = await (await session.apiAs(MEMBER_A)).post('/api/v1/scheduler/run')
  expect(res.status()).toBe(403)
})
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/scheduler.spec.ts --workers=1`
Expected: 7 passed. These tests depend on wall-clock send times — if one flakes near the UTC midnight or hour boundary, re-run it (`--retries` is 0 locally by design so flakes surface immediately).

- [ ] **Step 3: Commit**

```bash
git add web/e2e/scheduler.spec.ts
git commit -m "test(web): scheduler e2e — dedupe, per-channel rows, failed-not-logged, missed, future, 403"
```

---

### Task 10: Mobile viewport spec

**Files:**
- Create: `web/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `session.pageAs(email, opts)` with `{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }`; `seedContact`.
- UI contract: below `md` the top nav collapses behind the `Open navigation` sheet (dismiss via `Dismiss navigation`); below `lg`, tapping a contact row **navigates** to `/reminder/contacts/{uuid}` instead of docking a side panel.

- [ ] **Step 1: Write `web/e2e/mobile.spec.ts`**

```ts
import { test, expect } from './fixtures'
import { seedContact, uniq } from './helpers/seed'

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const

test('navigation sheet works on mobile and links to Contacts', async ({ session }) => {
  const page = await session.pageAs(undefined, MOBILE)
  await page.goto('/reminder')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Contacts' }).click()
  await expect(page).toHaveURL(/\/reminder\/contacts$/)
})

test('tapping a contact navigates to its detail page (no docked panel)', async ({ session }) => {
  const name = uniq('Mobile Nyoman')
  const id = await seedContact(await session.apiAs(), { name })
  const page = await session.pageAs(undefined, MOBILE)
  await page.goto('/reminder/contacts')
  await page.getByText(name).first().click()
  await expect(page).toHaveURL(new RegExp(`/reminder/contacts/${id}$`))
  await expect(page.getByText(name).first()).toBeVisible()
})
```

- [ ] **Step 2: Run**

Run: `cd web && pnpm exec playwright test e2e/mobile.spec.ts`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/mobile.spec.ts
git commit -m "test(web): mobile viewport e2e — nav sheet, detail navigation"
```

---

### Task 11: CI e2e job, README, full-suite verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md` (Development section)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add the e2e job to `.github/workflows/ci.yml`** (new job after `test:`)

```yaml
  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0
        with:
          go-version-file: go.mod

      - uses: pnpm/action-setup@d9184bf108216479bc5a137cc391f4d7b14c870b # v6.1.0
        with:
          package_json_file: web/package.json

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml

      - name: Install web deps
        working-directory: web
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        working-directory: web
        run: pnpm exec playwright install --with-deps chromium

      - name: Build SPA + binary
        run: make build

      - name: Run e2e
        working-directory: web
        run: pnpm exec playwright test

      - name: Upload Playwright report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: web/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: README Development section** — extend the code block list with one line and a short paragraph after it:

```markdown
make e2e     # build + run the Playwright e2e suite (web/e2e, chromium)
```

The e2e suite spawns a real `bin/wimember` per worker (`AUTH_MODE=dev`, fresh SQLite under a temp `DATA_DIR`) and asserts against the database file directly. First run needs `cd web && pnpm exec playwright install chromium`; debug a failure with `E2E_KEEP_DATA=1 make e2e` (keeps the temp dir + server log) and `cd web && pnpm run test:e2e:report`.

- [ ] **Step 3: Full clean verification**

```bash
make e2e            # expect: all specs green
make e2e            # run 2 — flake check
make e2e            # run 3 — flake check
make test           # Go suite still green
cd web && pnpm run lint && pnpm run build   # lint + SPA build still green
```

Expected: three consecutive green `make e2e` runs; Go tests, lint, and build unaffected.

- [ ] **Step 4: Spot-verify the suite fails when it should (spec's "testing the tests")**

One mutation per assertion family, `make e2e` after each, expect the matching spec to FAIL, then revert:

1. Dedupe: in `internal/store/log.go`, make `RecordNotification` skip the insert → scheduler dedupe test fails (0 log rows).
2. Encryption: in `internal/api/handlers.go` `encryptConfig`, store the raw JSON instead of the sealed blob → channels encryption test fails (plaintext found).
3. Scoping: in `internal/api/handlers.go` `scope`, always return `""` → owner-scoping tests fail.

```bash
# after each mutation + run + revert:
git checkout -- internal/
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: e2e playwright job + make e2e docs"
```

---

## Self-Review notes (resolved during planning)

- Spec coverage: harness (Tasks 1–3), contacts (4), occasions (5), channels + encryption (6), settings (7), upcoming + Remind-Now-unlogged + Feb29/otonan (8), scheduler family (9), mobile (10), CI + "suite fails when it should" spot-mutations (11). All spec sections map to tasks.
- The spec's original "days=91 → 400" was corrected to the real behaviors (silent clamp; 400s come from `from`/`to` validation) — the spec file was amended in the same commit range.
- Type consistency: `App` (baseUrl/dataDir/dbPath/db/logPath + stubUrl/stubMessages/stubServer), `Session` (pageAs/apiAs), `SettingsPayload`, helper names match across tasks.
- ESM safety: `web/package.json` is `"type": "module"`, so all path resolution in `global-setup.ts` and `fixtures.ts` uses `fileURLToPath(new URL(..., import.meta.url))`, never `__dirname`.
- `occasion_prefs`/`reminder_prefs` are keyed by `occasion_id`/`contact_id` (no `id` column) — reads use direct `prepare(...)` with the right key, never `rowById`.
- Settings-spec tests run in declaration order against the shared worker DB; the invalid-save test compares the blob before/after instead of assuming null.
- Known soft locators called out in-line with fallbacks: timezone combobox, `#ch-active-{id}`, accordion `Toggle … details`.
