import { verify } from 'node:crypto'

// SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const MAX_CLOCK_SKEW_SECONDS = 5 * 60

export function verifyDiscordSignature(args: {
  publicKey: string
  signature?: string
  timestamp?: string
  rawBody: string
  now?: number
}): boolean {
  if (!args.signature || !args.timestamp) return false
  const timestampSeconds = Number(args.timestamp)

  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs((args.now ?? Date.now()) / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return false
  }

  try {
    const rawKey = Buffer.from(args.publicKey, 'hex')

    if (rawKey.length !== 32) return false

    return verify(
      null,
      Buffer.from(`${args.timestamp}${args.rawBody}`),
      { key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]), format: 'der', type: 'spki' },
      Buffer.from(args.signature, 'hex'),
    )
  } catch {
    return false
  }
}
