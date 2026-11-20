import { describe, expect, test } from 'bun:test'

import { getCloudflareOauthConnection } from './cloudflare-iam'

const meta = {
  accountId: 'acc',
  accountName: null,
  clientId: 'client',
  accessTokenExpiresAt: null,
  hasRefreshToken: true,
}

describe('getCloudflareOauthConnection', () => {
  test('asks to reconnect a grant without analytics.read', async () => {
    const conn = await getCloudflareOauthConnection(null, {
      ...meta,
      scope: 'zone.read offline_access',
    })

    expect(conn.warnings.some((w) => w.includes('Update scopes'))).toBe(true)
  })

  test('does not warn once analytics.read is granted', async () => {
    const conn = await getCloudflareOauthConnection(null, {
      ...meta,
      scope: 'zone.read analytics.read offline_access',
    })

    expect(conn.warnings.some((w) => w.includes('analytics.read'))).toBe(false)
  })
})
