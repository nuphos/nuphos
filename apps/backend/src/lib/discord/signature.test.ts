import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, test } from 'bun:test'

import { verifyDiscordSignature } from './signature'

describe('verifyDiscordSignature', () => {
  test('accepts a current signed body and rejects mutation or stale delivery', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const timestamp = '1700000000'
    const rawBody = '{"type":1}'
    const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`), privateKey).toString('hex')
    const publicDer = publicKey.export({ type: 'spki', format: 'der' })
    const publicHex = publicDer.subarray(publicDer.length - 32).toString('hex')
    const now = Number(timestamp) * 1000

    expect(
      verifyDiscordSignature({ publicKey: publicHex, signature, timestamp, rawBody, now }),
    ).toBe(true)
    expect(
      verifyDiscordSignature({
        publicKey: publicHex,
        signature,
        timestamp,
        rawBody: `${rawBody} `,
        now,
      }),
    ).toBe(false)
    expect(
      verifyDiscordSignature({
        publicKey: publicHex,
        signature,
        timestamp,
        rawBody,
        now: now + 6 * 60_000,
      }),
    ).toBe(false)
  })
})
