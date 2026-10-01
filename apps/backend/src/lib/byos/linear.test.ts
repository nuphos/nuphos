import { describe, expect, test } from 'bun:test'

import { buildAuthorizeUrl, parseTokenResponse } from './linear'

describe('buildAuthorizeUrl', () => {
  test('targets the Linear authorize endpoint with the required OAuth params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-123',
        redirectUri: 'https://api.nuphos.ai/linear-app/setup',
        state: 'abc123',
        scope: 'read,write',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.nuphos.ai/linear-app/setup')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc123')
    expect(url.searchParams.get('scope')).toBe('read,write')
    expect(url.searchParams.get('actor')).toBe('app')
  })
})

describe('parseTokenResponse', () => {
  test('keeps the refresh token and expiry from an authorization_code exchange', () => {
    const before = Date.now()
    const out = parseTokenResponse({
      access_token: 'acc-tok',
      token_type: 'Bearer',
      expires_in: 86399,
      refresh_token: 'ref-tok',
      scope: 'read,write',
    })

    expect(out.accessToken).toBe('acc-tok')
    expect(out.refreshToken).toBe('ref-tok')
    expect(out.scope).toBe('read,write')
    expect(out.expiresAt).not.toBeNull()
    const ms = out.expiresAt!.getTime()

    expect(ms).toBeGreaterThanOrEqual(before + 86399 * 1000)
    expect(ms).toBeLessThanOrEqual(Date.now() + 86399 * 1000)
  })

  test('takes the rotated refresh token over the stored one', () => {
    const out = parseTokenResponse(
      {
        access_token: 'new-acc',
        token_type: 'Bearer',
        expires_in: 86399,
        refresh_token: 'rotated',
      },
      'stored-refresh',
    )

    expect(out.refreshToken).toBe('rotated')
  })

  test('falls back to the stored refresh token when the response omits one', () => {
    const out = parseTokenResponse(
      { access_token: 'new-acc', token_type: 'Bearer', expires_in: 86399 },
      'stored-refresh',
    )

    expect(out.accessToken).toBe('new-acc')
    expect(out.refreshToken).toBe('stored-refresh')
  })

  test('joins an array-shaped scope', () => {
    const out = parseTokenResponse({
      access_token: 'a',
      token_type: 'Bearer',
      scope: ['read', 'write'],
    })

    expect(out.scope).toBe('read,write')
  })

  test('null refresh token and expiry when neither is present', () => {
    const out = parseTokenResponse({ access_token: 'a', token_type: 'Bearer' })

    expect(out.refreshToken).toBeNull()
    expect(out.expiresAt).toBeNull()
    expect(out.scope).toBe('')
  })
})
