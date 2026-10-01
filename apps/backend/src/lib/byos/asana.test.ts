import { describe, expect, test } from 'bun:test'

import { buildAuthorizeUrl, parseTokenResponse } from './asana'

describe('buildAuthorizeUrl', () => {
  test('targets the Asana authorize endpoint with the required OAuth params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-123',
        redirectUri: 'https://api.nuphos.ai/asana-app/setup',
        state: 'abc123',
        scope: 'default',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://app.asana.com/-/oauth_authorize')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.nuphos.ai/asana-app/setup')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc123')
    expect(url.searchParams.get('scope')).toBe('default')
  })
})

describe('parseTokenResponse', () => {
  test('extracts tokens, expiry, scope, and the authorising account from data', () => {
    const before = Date.now()
    const out = parseTokenResponse({
      access_token: 'acc-tok',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'ref-tok',
      scope: 'default',
      data: { gid: '9001', name: 'Jane Doe', email: 'jane@acme.com' },
    })

    expect(out.accessToken).toBe('acc-tok')
    expect(out.refreshToken).toBe('ref-tok')
    expect(out.scope).toBe('default')
    expect(out.account).toEqual({ gid: '9001', name: 'Jane Doe', email: 'jane@acme.com' })
    expect(out.expiresAt).not.toBeNull()
    const ms = out.expiresAt!.getTime()

    expect(ms).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(ms).toBeLessThanOrEqual(Date.now() + 3600 * 1000)
  })

  test('keeps the existing refresh token when a refresh response omits one (Asana does not rotate)', () => {
    const out = parseTokenResponse(
      { access_token: 'new-acc', token_type: 'bearer', expires_in: 3600 },
      'stored-refresh',
    )

    expect(out.accessToken).toBe('new-acc')
    expect(out.refreshToken).toBe('stored-refresh')
  })

  test('null refresh token and null account when neither is present', () => {
    const out = parseTokenResponse({ access_token: 'a', token_type: 'bearer' })

    expect(out.refreshToken).toBeNull()
    expect(out.account).toBeNull()
    expect(out.expiresAt).toBeNull()
    expect(out.scope).toBe('')
  })
})
