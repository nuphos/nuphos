import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { isFederatedTailscaleBinding, tailscaleAuthHandle } from './tailscale-binding'

const teamId = new ObjectId('507f1f77bcf86cd799439011')

describe('tailscaleAuthHandle', () => {
  // Verified against the live Tailscale API: creating a federated trust
  // credential without an explicit audience echoes back
  // `api.tailscale.com/<client-id>`, and a JWT carrying it exchanges cleanly.
  test('derives the audience Tailscale defaults to', () => {
    const handle = tailscaleAuthHandle({ clientId: 'abc123', federation: { audience: '' } }, teamId)

    expect(handle).toEqual({
      clientId: 'abc123',
      audience: 'api.tailscale.com/abc123',
      teamId: teamId.toHexString(),
    })
  })

  test('honours an audience the admin overrode on their trust credential', () => {
    const handle = tailscaleAuthHandle(
      { clientId: 'abc123', federation: { audience: 'my-own-aud' } },
      teamId,
    )

    expect(handle).toMatchObject({ audience: 'my-own-aud' })
  })

  // Federation must win outright: a binding that has both must never fall back
  // to the stored secret, or the credential we claim not to use stays live.
  test('prefers federation over a leftover stored secret', () => {
    const handle = tailscaleAuthHandle(
      {
        clientId: 'abc123',
        federation: { audience: 'aud' },
        encryptedClientSecret: {
          v: 1,
          alg: 'A256GCM',
          keyId: 'k',
          iv: 'i',
          authTag: 't',
          ciphertext: 'c',
        },
      },
      teamId,
    )

    expect('clientSecret' in handle).toBe(false)
  })

  test('refuses a binding carrying neither credential', () => {
    expect(() => tailscaleAuthHandle({ clientId: 'abc123' }, teamId)).toThrow(AppError)
  })
})

describe('isFederatedTailscaleBinding', () => {
  test('distinguishes the two binding shapes', () => {
    expect(isFederatedTailscaleBinding({ clientId: 'a', federation: { audience: 'x' } })).toBe(true)
    expect(isFederatedTailscaleBinding({ clientId: 'a' })).toBe(false)
  })
})
