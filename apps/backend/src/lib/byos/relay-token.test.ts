import { describe, expect, it } from 'bun:test'

import { deriveRelayStatusCredential, signRelayToken } from '@/lib/byos/relay-token'

/**
 * The relay verifies these tokens in Go, over the exact payload bytes, so the
 * encoding is a cross-language contract. apps/kube-relay/token_vector_test.go
 * pins the SAME secret, claims and expected string: if either side changes how
 * it serialises a token, one of the two tests fails instead of every enrolled
 * cluster silently failing to authenticate.
 */
const VECTOR_SECRET = '0123456789abcdef0123456789abcdef'

describe('signRelayToken', () => {
  it('matches the vector the Go relay pins', () => {
    expect(
      signRelayToken(VECTOR_SECRET, {
        k: 'cluster-key',
        p: 'session',
        exp: 1_700_003_600,
        s: 'session-1',
      }),
    ).toBe(
      'nr1_eyJrIjoiY2x1c3Rlci1rZXkiLCJwIjoic2Vzc2lvbiIsImV4cCI6MTcwMDAwMzYwMCwicyI6InNlc3Npb24tMSJ9.OHW_TwFLeewmNs3fbQq6MOKrdLNScZO2Uy0l1IbxiX8',
    )
  })

  it('omits the session claim for an agent token', () => {
    const token = signRelayToken(VECTOR_SECRET, {
      k: 'cluster-key',
      p: 'agent',
      exp: 1_700_003_600,
    })
    const payload = JSON.parse(
      Buffer.from(token.slice('nr1_'.length).split('.')[0]!, 'base64url').toString('utf8'),
    )

    // Go's encoding/json drops `s` when empty; an extra key here would change
    // the signed bytes and break verification on the relay.
    expect(Object.keys(payload)).toEqual(['k', 'p', 'exp'])
  })

  it('derives the status credential the relay expects, and it is not the secret', () => {
    // Same cross-language contract as the token vector: apps/kube-relay's
    // token_vector_test.go pins this exact string. The status listener is plain
    // HTTP, so what goes over it must not be the signing key.
    const credential = deriveRelayStatusCredential(VECTOR_SECRET)

    expect(credential).toBe('ab6371f73fc715869d26690d6a1f1978b0bdf8e7207de097897732f3492c6d2e')
    expect(credential).not.toContain(VECTOR_SECRET)
  })

  it('signs the payload, not the claims object', () => {
    const a = signRelayToken(VECTOR_SECRET, { k: 'a', p: 'agent', exp: 1 })
    const b = signRelayToken(VECTOR_SECRET, { k: 'b', p: 'agent', exp: 1 })

    expect(a.split('.')[1]).not.toBe(b.split('.')[1])
  })
})
