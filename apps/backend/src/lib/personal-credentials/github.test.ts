import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { exchangeGithubCode, githubAuthorizeUrl, githubUserInstallationIds } from './github'

afterEach(() => {
  ;(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.()
})

const exchange = () =>
  exchangeGithubCode({
    clientId: 'Iv1.client',
    clientSecret: 'secret',
    code: 'code-1',
    redirectUri: 'https://api.nuphos.ai/personal-credentials/github/callback',
    codeVerifier: 'verifier-1',
  })

describe('githubAuthorizeUrl', () => {
  test('asks the App OAuth client for a PKCE (S256) authorization', () => {
    const url = new URL(
      githubAuthorizeUrl({
        clientId: 'Iv1.client',
        redirectUri: 'https://api.nuphos.ai/personal-credentials/github/callback',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv1.client',
      redirect_uri: 'https://api.nuphos.ai/personal-credentials/github/callback',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    })
  })
})

describe('exchangeGithubCode', () => {
  test('sends the PKCE verifier and reads an expiring token pair', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ access_token: 'ghu_1', refresh_token: 'ghr_1', expires_in: 28_800 }),
    )

    const tokens = await exchange()
    const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string)

    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(tokens.accessToken).toBe('ghu_1')
    expect(tokens.refreshToken).toBe('ghr_1')
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 28_000_000)
  })

  test('treats GitHub’s HTTP 200 error body as a failure', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'bad_verification_code', error_description: 'expired code' }),
    )

    await expect(exchange()).rejects.toThrow('expired code')
  })
})

describe('githubUserInstallationIds', () => {
  test('reads every page of the user installations', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })), [{ id: 101 }]]

    spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL | Request) => {
      const page = Number(new URL(input as string).searchParams.get('page'))

      return Promise.resolve(Response.json({ installations: pages[page - 1] ?? [] }))
    }) as typeof fetch)

    const ids = await githubUserInstallationIds('token')

    expect(ids).toHaveLength(101)
    expect(ids.at(-1)).toBe(101)
  })
})
