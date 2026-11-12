import { createHmac, randomInt } from 'node:crypto'

import { hashToken } from '@/lib/oauth/tokens'

const STEP_SECONDS = 30
const DIGITS = 6
const RECOVERY_CODE_COUNT = 10

// ── TOTP (RFC 6238 over RFC 4226, SHA-1, six digits, 30 s): what every
// authenticator app accepts by default. ──

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31)
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31)

  return out
}

export function base32Decode(text: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []

  for (const ch of text.replaceAll('=', '').toUpperCase()) {
    const index = BASE32.indexOf(ch)

    if (index < 0) throw new Error('Invalid base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(out)
}

export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8)

  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', secret).update(counter).digest()
  const offset = hmac.readUInt8(hmac.length - 1) & 15
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** The time step `code` belongs to, allowing one step of clock drift either way. */
export function matchTotp(secret: Buffer, code: string, now = Date.now()): number | null {
  const current = Math.floor(now / 1000 / STEP_SECONDS)

  for (const step of [current, current - 1, current + 1]) {
    if (totpCode(secret, step) === code) return step
  }

  return null
}

// ── Recovery codes: ten of `xxxxx-xxxxx`, shown once, stored hashed. ──

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function newRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () =>
    RECOVERY_ALPHABET.charAt(randomInt(RECOVERY_ALPHABET.length)),
  )

  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '')

export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)

  return { codes, hashes: codes.map((code) => hashToken(normalizeRecoveryCode(code))) }
}

/** What an authenticator app scans to add the account. */
export function otpauthUrl(email: string, secret: string): string {
  const params = new URLSearchParams({
    secret,
    issuer: 'Nuphos',
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })

  const label = encodeURIComponent(`Nuphos:${email}`)

  return `otpauth://totp/${label}?${params.toString()}`
}
