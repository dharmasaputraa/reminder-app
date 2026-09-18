import type { DatabaseSync } from 'node:sqlite'

// Small read-side helpers over the fixture's `app.db` handle. The server owns
// writes; these exist so specs can assert on persisted state without going
// through the HTTP API. `node:sqlite` returns null-prototype row objects.

export function rows(db: DatabaseSync, sql: string, ...params: unknown[]): any[] {
  return db.prepare(sql).all(...(params as any[])) as any[]
}

export function rowById(db: DatabaseSync, table: string, id: string): any {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
}

export function count(db: DatabaseSync, table: string, where?: Record<string, unknown>): number {
  const keys = where ? Object.keys(where) : []
  const sql =
    `SELECT COUNT(*) AS n FROM ${table}` +
    (keys.length ? ` WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}` : '')
  const r = db.prepare(sql).get(...((where ? Object.values(where) : []) as any[])) as any
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
  const sql =
    'SELECT * FROM notification_log' +
    (keys.length ? ` WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}` : '') +
    ' ORDER BY sent_at, id'
  return rows(db, sql, ...keys.map((k) => (filter as any)[k]))
}

export function channelConfigEnc(db: DatabaseSync, id: string): Uint8Array {
  const r = db.prepare('SELECT config_enc FROM channels WHERE id = ?').get(id) as any
  return r.config_enc as Uint8Array
}
