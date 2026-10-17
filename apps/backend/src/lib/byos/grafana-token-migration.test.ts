import { describe, expect, test } from 'bun:test'

import { grafanaTokenStep } from './grafana-token-migration'
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
