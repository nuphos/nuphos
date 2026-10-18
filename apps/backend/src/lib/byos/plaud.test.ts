import { afterEach, describe, expect, test } from 'bun:test'

import {
  buildPlaudAuthorizeUrl,
  exchangePlaudCode,
  fetchPlaudUser,
  registerPlaudClient,
} from './plaud'

const realFetch = globalThis.fetch
const calls: { url: string; init?: RequestInit }[] = []

afterEach(() => {
  globalThis.fetch = realFetch
  calls.length = 0
})

function respond(body: unknown, status = 200) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })

    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

describe('Plaud OAuth', () => {
  test('registers a public PKCE client for the callback', async () => {
    respond({ client_id: 'signed-client' })

    expect(await registerPlaudClient('https://api.example.com/plaud-app/callback')).toBe(
      'signed-client',
    )
    expect(calls[0]?.url).toBe('https://mcp.plaud.ai/register')
    expect(JSON.parse(calls[0]?.init?.body as string)).toMatchObject({
      redirect_uris: ['https://api.example.com/plaud-app/callback'],
      token_endpoint_auth_method: 'none',
    })
  })

  test('authorizes with an S256 challenge', () => {
    const url = new URL(
      buildPlaudAuthorizeUrl({
        clientId: 'c',
        redirectUri: 'https://api.example.com/plaud-app/callback',
        state: 's',
        codeChallenge: 'challenge',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://mcp.plaud.ai/authorize')
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  test('exchanges the code with the verifier and computes the expiry', async () => {
    respond({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })
    const tokens = await exchangePlaudCode({
      clientId: 'c',
      redirectUri: 'https://api.example.com/plaud-app/callback',
      code: 'code',
      codeVerifier: 'verifier',
    })

    expect(tokens.accessToken).toBe('a')
    expect(tokens.refreshToken).toBe('r')
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3500_000)
    expect(new URLSearchParams(calls[0]?.init?.body as string).get('code_verifier')).toBe(
      'verifier',
    )
  })

  test('reads the user whether or not the response is wrapped in data', async () => {
    respond({ data: { id: 'u1', nickname: 'Ada', email: 'ada@example.com' } })
    expect(await fetchPlaudUser('a')).toEqual({ id: 'u1', name: 'Ada', email: 'ada@example.com' })

    respond({ id: 'u2' })
    expect(await fetchPlaudUser('a')).toEqual({ id: 'u2', name: null, email: null })
  })

  test('surfaces a rejected token exchange', async () => {
    respond({ error: 'invalid_grant' }, 400)

    await expect(
      exchangePlaudCode({ clientId: 'c', redirectUri: 'r', code: 'x', codeVerifier: 'v' }),
    ).rejects.toThrow('400')
  })
})
