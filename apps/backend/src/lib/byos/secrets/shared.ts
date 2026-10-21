import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { optional } from '@/config/env'
import { AppError } from '@/lib/errors'

export type EncryptedSecret = {
  v: 1
  alg: 'A256GCM'
  keyId: string
  iv: string
  authTag: string
  ciphertext: string
}

export function decodeMasterKey(raw: string, sourceEnv: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  const key = Buffer.from(raw, 'base64')

  if (key.length !== 32) {
    throw new Error(`${sourceEnv} must decode to 32 bytes`)
  }

  return key
}

// GCM authenticates, so a wrong key fails instead of returning garbage.
function openWith(key: Buffer, envelope: EncryptedSecret): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))

    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

export type Sealer = {
  seal: (plaintext: string) => EncryptedSecret
  open: (envelope: EncryptedSecret) => string
  /** The envelope re-sealed with the current key, or null when it already opens with it. */
  rewrap: (envelope: EncryptedSecret) => EncryptedSecret | null
}

/**
 * AES-256-GCM envelopes under one BYOK key. `keyEnvs` lists the env vars that
 * may hold the key, in fallback order. The one in use may be paired with
 * `<NAME>_PREVIOUS`, the key it replaced, which still opens old envelopes so a
 * rotation needs no downtime: set NAME to the new key and NAME_PREVIOUS to the
 * old one, deploy, run scripts/rewrap-byok-secrets.ts, then drop NAME_PREVIOUS.
 */
export function createSealer(options: {
  /** What the envelope holds, e.g. "Grafana credentials". */
  subject: string
  keyEnvs: string[]
  /** The id stamped on new envelopes. */
  keyId: () => string
  /** How the user recovers from an envelope no configured key opens. */
  recovery: string
}): Sealer {
  const { subject, keyEnvs, recovery } = options

  function keys(): { keyId: string; current: Buffer; previous?: Buffer } {
    for (const env of keyEnvs) {
      const raw = optional(env)

      if (!raw) continue
      const previous = optional(`${env}_PREVIOUS`)

      try {
        return {
          keyId: options.keyId(),
          current: decodeMasterKey(raw, env),
          previous: previous ? decodeMasterKey(previous, `${env}_PREVIOUS`) : undefined,
        }
      } catch (err) {
        throw new AppError(503, 'credential_key_unavailable', (err as Error).message)
      }
    }
    throw new AppError(
      503,
      'credential_key_unavailable',
      `${keyEnvs.join(' or ')} is required to store ${subject}`,
    )
  }

  function seal(plaintext: string): EncryptedSecret {
    const { keyId, current } = keys()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', current, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

    return {
      v: 1,
      alg: 'A256GCM',
      keyId,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  }

  function unseal(envelope: EncryptedSecret): { plaintext: string; current: boolean } {
    if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
      throw new AppError(
        422,
        'credential_envelope_unsupported',
        `Unsupported envelope for the stored ${subject} (v=${String(envelope.v)}, alg=${envelope.alg}). ${recovery}`,
      )
    }
    const { keyId, current, previous } = keys()
    // Envelopes whose id differs from the current one most likely predate the
    // rotation, so try the previous key first. The id is only a hint: many
    // providers stamp a fixed "default", so both keys are always tried.
    const order = previous && envelope.keyId !== keyId ? [previous, current] : [current, previous]

    for (const key of order) {
      const plaintext = key ? openWith(key, envelope) : null

      if (plaintext !== null) return { plaintext, current: key === current }
    }
    // The agent reads this code as "re-bind", not "retry".
    throw new AppError(
      422,
      'credential_key_mismatch',
      `Cannot decrypt the stored ${subject}: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${keyId}". ${recovery}`,
    )
  }

  return {
    seal,
    open: (envelope) => unseal(envelope).plaintext,
    rewrap: (envelope) => {
      const { plaintext, current } = unseal(envelope)

      return current ? null : seal(plaintext)
    },
  }
}
