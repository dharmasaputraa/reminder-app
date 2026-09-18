import { createDecipheriv, createHash } from 'node:crypto'

/** Mirror of internal/secret: key = sha256(APP_SECRET), blob = nonce(12) ‖ ct ‖ tag(16). */
export function decryptConfig(appSecret: string, blob: Uint8Array): string {
  const key = createHash('sha256').update(appSecret).digest()
  const buf = Buffer.from(blob)
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8')
}
