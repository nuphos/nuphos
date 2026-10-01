import { createHash } from 'node:crypto'

import { describe, expect, test } from 'bun:test'

import { discoverPosthogAccount, PosthogApiError } from './posthog'
import {
  buildPosthogAuthorizeUrl,
  createPkcePair,
  exchangePosthogCode,
  posthogClientMetadata,
  refreshPosthogTokens,
  revokePosthogToken,
} from './posthog-oauth'

import type { PosthogFetch } from './posthog'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const credentials = { apiBaseUrl: 'https://eu.posthog.com', accessToken: 'pha_secret' }
const client = {
  clientId: 'https://api-dev.example.com/posthog-app/client-metadata.json',
  redirectUri: 'https://api-dev.example.com/posthog-app/callback',
}

function router(routes: Record<string, () => Response>, seen: string[] = []): PosthogFetch {
  return async (url, init) => {
    const { pathname, search, origin } = new URL(url)
    const headers = new Headers(init.headers)

    seen.push(`${origin} ${headers.get('authorization') ?? ''} ${pathname}${search}`)
    const route = Object.entries(routes).find(([prefix]) => pathname.startsWith(prefix))

    return route ? route[1]() : json({ detail: 'Not found.' }, 404)
  }
}

const me = {
  uuid: 'user-uuid',
  email: 'jane@acme.com',
  first_name: 'Jane',
  last_name: 'Doe',
  organizations: [
    { id: 'org-a', name: 'Acme' },
    { id: 'org-b', name: 'Other' },
  ],
}

describe('PostHog OAuth client', () => {
  test('publishes a public-client metadata document whose client_id is its own URL', () => {
    expect(posthogClientMetadata(client, ['user:read', 'dashboard:write'])).toMatchObject({
      client_id: client.clientId,
      redirect_uris: [client.redirectUri],
      token_endpoint_auth_method: 'none',
      'com.posthog': { scopes: ['user:read', 'dashboard:write'] },
    })
  })

  test('authorizes against the chosen region with PKCE S256', () => {
    const pkce = createPkcePair()
    const url = new URL(
      buildPosthogAuthorizeUrl({
        region: 'eu',
        client,
        state: 's1',
        codeChallenge: pkce.challenge,
        scopes: ['user:read', 'insight:write'],
      }),
    )

    expect(url.origin + url.pathname).toBe('https://eu.posthog.com/oauth/authorize/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      scope: 'user:read insight:write',
      state: 's1',
      code_challenge: createHash('sha256').update(pkce.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
  })

  test('exchanges the code as a public client and reads the scoped projects', async () => {
    let form: URLSearchParams | null = null
    const fetchImpl: PosthogFetch = async (url, init) => {
      expect(url).toBe('https://us.posthog.com/oauth/token/')
      form = new URLSearchParams(init.body as string)

      return json({
        access_token: 'pha_1',
        refresh_token: 'phr_1',
        expires_in: 3600,
        scope: 'user:read project:read',
        scoped_teams: [12],
        scoped_organizations: [],
        posthog_region: 'us',
      })
    }
    const tokens = await exchangePosthogCode(
      { region: 'us', client, code: 'c1', codeVerifier: 'v1' },
      fetchImpl,
    )

    expect(Object.fromEntries(form!)).toEqual({
      grant_type: 'authorization_code',
      code: 'c1',
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      code_verifier: 'v1',
    })
    expect(tokens).toMatchObject({
      accessToken: 'pha_1',
      refreshToken: 'phr_1',
      scopedTeams: [12],
    })
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3500_000)
  })

  test('revokes a token at the region endpoint as a public client', async () => {
    let seen: { url: string; form: Record<string, string> } | null = null

    await revokePosthogToken(
      {
        apiBaseUrl: 'https://eu.posthog.com',
        clientId: client.clientId,
        token: 'phr_old',
        hint: 'refresh_token',
      },
      async (url, init) => {
        seen = { url, form: Object.fromEntries(new URLSearchParams(init.body as string)) }

        return new Response(null, { status: 200 })
      },
    )

    expect(seen!).toEqual({
      url: 'https://eu.posthog.com/oauth/revoke/',
      form: { token: 'phr_old', token_type_hint: 'refresh_token', client_id: client.clientId },
    })
  })

  test('surfaces invalid_grant on refresh as a 400 PosthogApiError', async () => {
    const error = await refreshPosthogTokens(
      { apiBaseUrl: 'https://eu.posthog.com', clientId: client.clientId, refreshToken: 'phr_x' },
      async () => json({ error: 'invalid_grant' }, 400),
    ).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(PosthogApiError)
    expect(error).toMatchObject({ status: 400, code: 'invalid_grant' })
  })
})

describe('discoverPosthogAccount', () => {
  test('lists reachable projects with the bearer token and skips denied organizations', async () => {
    const seen: string[] = []
    const discovery = await discoverPosthogAccount(
      credentials,
      [],
      router(
        {
          '/api/users/@me/': () => json(me),
          '/api/organizations/org-a/projects/': () =>
            json({
              next: null,
              results: [
                { id: 1, name: 'Web' },
                { id: 2, name: '' },
              ],
            }),
          '/api/organizations/org-b/projects/': () => json({ detail: 'Forbidden' }, 403),
        },
        seen,
      ),
    )

    expect(discovery).toEqual({
      user: { uuid: 'user-uuid', email: 'jane@acme.com', name: 'Jane Doe' },
      projects: [
        { id: 1, name: 'Web', organizationId: 'org-a', organizationName: 'Acme' },
        { id: 2, name: 'Project 2', organizationId: 'org-a', organizationName: 'Acme' },
      ],
    })
    expect(seen.every((line) => line.startsWith('https://eu.posthog.com Bearer pha_secret '))).toBe(
      true,
    )
  })

  test('narrows to the projects granted on the consent screen', async () => {
    const discovery = await discoverPosthogAccount(
      credentials,
      [2],
      router({
        '/api/users/@me/': () => json({ ...me, organizations: [{ id: 'org-a', name: 'Acme' }] }),
        '/api/organizations/org-a/projects/': () =>
          json({
            results: [
              { id: 1, name: 'Web' },
              { id: 2, name: 'App' },
            ],
          }),
      }),
    )

    expect(discovery.projects.map((project) => project.id)).toEqual([2])
  })

  test('pages through large organizations', async () => {
    let calls = 0
    const discovery = await discoverPosthogAccount(
      credentials,
      [],
      router({
        '/api/users/@me/': () => json({ ...me, organizations: [{ id: 'org-a', name: 'Acme' }] }),
        '/api/organizations/org-a/projects/': () => {
          calls += 1

          return json({
            next: calls === 1 ? 'https://eu.posthog.com/next' : null,
            results: [{ id: calls, name: `P${String(calls)}` }],
          })
        },
      }),
    )

    expect(discovery.projects.map((project) => project.id)).toEqual([1, 2])
  })

  test('propagates an expired token as a 401', async () => {
    const error = await discoverPosthogAccount(
      credentials,
      [],
      router({ '/api/users/@me/': () => json({ detail: 'expired' }, 401) }),
    ).catch((err: unknown) => err)

    expect(error).toMatchObject({ status: 401 })
  })
})
