import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Authenticated symmetric encryption for secrets HQ holds at rest.
 *
 * AES-256-GCM. GCM rather than CBC because it authenticates: a tampered
 * ciphertext fails to decrypt instead of returning plausible garbage, which
 * for an API token is the difference between a loud failure and a confusing
 * one.
 *
 * Wire format is `base64(iv):base64(authTag):base64(ciphertext)` — three
 * fields, colon-separated, so a blob carries everything decryption needs and
 * a rotation of the key is detectable (decrypt throws) rather than silent.
 *
 * Written 2026-09-02: the repo had no encryption of its own. The nearest
 * thing, `ccCardNumberEncrypted`, is a CardSecure token issued BY CardPointe
 * — we never held the PAN, so we never needed a cipher. This is the first
 * secret HQ actually keeps.
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit nonce, the GCM standard

function keyFrom(keyB64: string, label: string): Buffer {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) {
    // Deliberately does not echo the value.
    throw new Error(`${label} must be 32 bytes base64-encoded (got ${key.length} bytes)`)
  }
  return key
}

export function encryptSecret(plaintext: string, keyB64: string, label = 'key'): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, keyFrom(keyB64, label), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(
    ':',
  )
}

export function decryptSecret(blob: string, keyB64: string, label = 'key'): string {
  const parts = blob.split(':')
  if (parts.length !== 3) throw new Error('ciphertext is not in iv:tag:data form')
  const [ivB64, tagB64, dataB64] = parts
  const decipher = createDecipheriv(ALGO, keyFrom(keyB64, label), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** The key the RentalWorks credential is sealed with. */
export function rwTokenKey(): string {
  const k = process.env.RW_TOKEN_KEY
  if (!k) throw new Error('RW_TOKEN_KEY is not set — cannot read or write the RentalWorks token')
  return k
}
