import { afterAll, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import { resolveCloudflareScopeParam } from './cloudflare-oauth-scopes'

const oauth = config.byos.cloudflare.oauth
const realFetch = globalThis.fetch
const savedToken = oauth.adminToken
const calls: string[] = []

// Cloudflare's API as the owning account's "OAuth Client Read" token sees it.
const cloudflare: Record<string, unknown> = {
  '/accounts': [{ id: 'acct' }],
  '/accounts/acct/oauth_clients/client': {
    scopes: ['account-settings.read', 'zone.read', 'dns.read', 'dns.write', 'd1.read', 'd1.write'],
  },
  '/oauth/scopes?per_page=1000': [
    { id: 'account-settings.read', category: 'account_and_billing' },
    { id: 'zone.read', category: 'dns_and_zones' },
    { id: 'dns.read', category: 'dns_and_zones' },
    { id: 'dns.write', category: 'dns_and_zones' },
    { id: 'd1.read', category: 'developer_platform' },
    { id: 'd1.write', category: 'developer_platform' },
    { id: 'workers-r2.write', category: 'developer_platform' },
  ],
}

globalThis.fetch = (async (url: string) => {
  const path = url.replace(oauth.apiUrl, '')

  calls.push(path)
  const result = cloudflare[path]

  return Response.json(result ? { success: true, result } : { success: false }, {
    status: result ? 200 : 404,
  })
}) as unknown as typeof fetch

afterAll(() => {
  globalThis.fetch = realFetch
  oauth.adminToken = savedToken
})

describe('resolveCloudflareScopeParam', () => {
  test('fails with the reason when the admin token is missing', async () => {
    oauth.adminToken = undefined

    await expect(resolveCloudflareScopeParam('client', {})).rejects.toThrow(
      'CLOUDFLARE_OAUTH_ADMIN_TOKEN is not set',
    )
  })

  test('expands category access into the scopes the client is registered with', async () => {
    oauth.adminToken = 'test-token-not-a-credential'

    expect(
      (
        await resolveCloudflareScopeParam('client', {
          access: { dns_and_zones: 'read', developer_platform: 'write' },
        })
      ).split(' '),
    ).toEqual([
      'account-settings.read',
      'zone.read',
      'dns.read',
      'd1.read',
      'd1.write',
      'offline_access',
    ])
  })

  test('drops scopes an older desktop sends that the client is not registered with', async () => {
    expect(
      await resolveCloudflareScopeParam('client', {
        scopes: ['dns.write', 'workers-r2.write', 'dns-firewall.read'],
      }),
    ).toBe('dns.write offline_access')
  })

  test('reads the registration once and reuses it', () => {
    expect(calls.filter((c) => c === '/oauth/scopes?per_page=1000')).toHaveLength(1)
  })
})
