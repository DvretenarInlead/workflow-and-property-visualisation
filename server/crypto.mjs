// Secret handling: AES-256-GCM for HubSpot tokens at rest, HMAC-signed session
// cookies. All keyed off APP_SECRET (a long random string set in the environment).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const APP_SECRET = process.env.APP_SECRET || ''

// Derive stable 32-byte keys from APP_SECRET (distinct salts for enc vs sign).
function key(salt) {
  return scryptSync(APP_SECRET, salt, 32)
}

export function secretConfigured() {
  return APP_SECRET.length >= 16
}

/** Encrypt a token → "iv.tag.ciphertext" (all base64url). */
export function encrypt(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key('enc'), iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ct].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(payload) {
  const [ivB, tagB, ctB] = String(payload).split('.')
  const decipher = createDecipheriv('aes-256-gcm', key('enc'), Buffer.from(ivB, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8')
}

// --- Signed session cookie: "value.signature" ---
export function sign(value) {
  const sig = createHmac('sha256', key('sign')).update(value).digest('base64url')
  return `${value}.${sig}`
}

export function verify(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null
  const i = signed.lastIndexOf('.')
  const value = signed.slice(0, i)
  const sig = signed.slice(i + 1)
  const expected = createHmac('sha256', key('sign')).update(value).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return value
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}
