import { test as base, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
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

async function startApp(): Promise<{ app: App; stop: () => Promise<void> }> {
  const workerIndex = process.env.TEST_PARALLEL_INDEX ?? '0'
  const dataDir = await mkdtemp(path.join(os.tmpdir(), `wimember-e2e-${process.pid}-${workerIndex}-`))
  const dbPath = path.join(dataDir, 'wimember.db')
  const logPath = path.join(dataDir, 'server.log')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const bin = fileURLToPath(new URL('../../bin/wimember', import.meta.url)) // ESM-safe: no __dirname under type:module

  const logStream = createWriteStream(logPath)
  const child = spawn(bin, [], {
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

  // Fail fast (instead of polling for 30s) when the process dies or cannot spawn.
  let spawnError: Error | undefined
  child.on('error', (err) => {
    spawnError = err
  })
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e] server exited with code ${code} — log: ${logPath}`)
    }
  })

  let up = false
  for (let i = 0; i < 150 && !up; i++) {
    if (spawnError || child.exitCode !== null) break
    try {
      const res = await fetch(`${baseUrl}/healthz`)
      up = res.ok
    } catch {
      // not listening yet
    }
    if (!up) await sleep(200)
  }
  if (!up) {
    if (spawnError) throw new Error(`failed to spawn ${bin}: ${spawnError.message} — log: ${logPath}`)
    throw new Error(`server did not become healthy on ${baseUrl} — see ${logPath}`)
  }

  const db = new DatabaseSync(dbPath)
  // The server holds the same file open in WAL mode; give our reads/writes the
  // same busy timeout it uses (PRAGMA via the Go DSN is per-connection).
  db.exec('PRAGMA busy_timeout = 5000')

  const stop = async () => {
    db.close()
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      const deadline = Date.now() + 5_000
      while (child.exitCode === null && Date.now() < deadline) await sleep(50)
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    logStream.end()
    if (process.env.E2E_KEEP_DATA === '1') {
      console.log(`E2E_KEEP_DATA=1 — keeping ${dataDir} (server log: ${logPath})`)
      return
    }
    await rm(dataDir, { recursive: true, force: true })
  }

  return { app: { baseUrl, dataDir, dbPath, db, logPath }, stop }
}

export const test = base.extend<{ app: App }, { app: App }>({
  app: [
    async ({}, use) => {
      const { app, stop } = await startApp()
      try {
        await use(app)
      } finally {
        await stop()
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
})

export { expect }
