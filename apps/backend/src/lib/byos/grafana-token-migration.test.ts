import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { grafanaTokenStep, grafanaTokenUpdate } from './grafana-token-migration'
import { decryptGrafanaSecret, encryptGrafanaSecret, grafanaBindingToken } from './secrets'

describe('Grafana token encryption', () => {
  test('round-trips and never stores the plaintext', () => {
    const envelope = encryptGrafanaSecret('glsa_example')

    expect(envelope.ciphertext).not.toContain('glsa_example')
    expect(decryptGrafanaSecret(envelope)).toBe('glsa_example')
  })

  test('a tampered envelope is rejected', () => {
    const envelope = encryptGrafanaSecret('glsa_example')

    expect(() =>
      decryptGrafanaSecret({ ...envelope, authTag: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/Re-bind the Grafana instance/)
  })

  test('bindings prefer the encrypted token and fall back to legacy plaintext', () => {
    expect(
      grafanaBindingToken({ encryptedSaToken: encryptGrafanaSecret('new'), saToken: 'old' }),
    ).toBe('new')
    expect(grafanaBindingToken({ saToken: 'old' })).toBe('old')
    expect(() => grafanaBindingToken({})).toThrow(/no token/)
  })
})

describe('grafanaTokenStep', () => {
  const encrypted = encryptGrafanaSecret('tok')

  test('encrypts plaintext-only bindings and keeps the plaintext by default', () => {
    expect(grafanaTokenStep({ saToken: 'tok' }, false)).toBe('encrypt')
    expect(grafanaTokenStep({ saToken: 'tok', encryptedSaToken: encrypted }, false)).toBe('skip')
    expect(grafanaTokenStep({ encryptedSaToken: encrypted }, true)).toBe('skip')
  })

  test('drops the plaintext only when the encrypted copy matches it', () => {
    expect(grafanaTokenStep({ saToken: 'tok', encryptedSaToken: encrypted }, true)).toBe(
      'unset-plaintext',
    )
    expect(() => grafanaTokenStep({ saToken: 'other', encryptedSaToken: encrypted }, true)).toThrow(
      /does not match/,
    )
  })
})

describe('grafanaTokenUpdate', () => {
  const id = new ObjectId()

  test('encrypt only fills a missing envelope next to the plaintext it was read with', () => {
    const { update, arrayFilters } = grafanaTokenUpdate({ id, saToken: 'tok' }, 'encrypt')
    const envelope = (update.$set as Record<string, Parameters<typeof decryptGrafanaSecret>[0]>)[
      'grafanaInstances.$[g].encryptedSaToken'
    ]!

    expect(decryptGrafanaSecret(envelope)).toBe('tok')
    expect(arrayFilters).toEqual([
      { 'g.id': id, 'g.saToken': 'tok', 'g.encryptedSaToken': { $exists: false } },
    ])
  })

  test('unset only removes the plaintext when both values are still the verified ones', () => {
    const encryptedSaToken = encryptGrafanaSecret('tok')
    const { update, arrayFilters } = grafanaTokenUpdate(
      { id, saToken: 'tok', encryptedSaToken },
      'unset-plaintext',
    )

    expect(update).toEqual({ $unset: { 'grafanaInstances.$[g].saToken': '' } })
    expect(arrayFilters).toEqual([
      {
        'g.id': id,
        'g.saToken': 'tok',
        'g.encryptedSaToken.ciphertext': encryptedSaToken.ciphertext,
      },
    ])
  })
})
