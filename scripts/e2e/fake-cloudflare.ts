import { createServer } from 'node:http'

import type { AddressInfo } from 'node:net'

/** Set to answer as Cloudflare does for a revoked token. */
export const fakeCloudflare = { rejectToken: false }

// Cloudflare's API as the backend's "OAuth Client Read" token sees it, and the
// backend environment that points at it. Cloudflare itself is never reached: a
// scenario answers for it on the setup redirect.
export async function fakeCloudflareEnv(apiUrl: string): Promise<Record<string, string>> {
  const scopes = [
    { id: 'account-settings.read', category: 'account_and_billing' },
    { id: 'user-details.read', category: 'account_and_billing' },
    { id: 'memberships.read', category: 'account_and_billing' },
    { id: 'zone.read', category: 'dns_and_zones' },
    { id: 'dns.write', category: 'dns_and_zones' },
    { id: 'workers-scripts.write', category: 'developer_platform' },
  ]
  const answers: Record<string, unknown> = {
    '/accounts': [{ id: 'e2e' }],
    '/accounts/e2e/oauth_clients/e2e-cloudflare-client': { scopes: scopes.map((s) => s.id) },
    '/oauth/scopes?per_page=1000': scopes,
  }
  const server = createServer((request, response) => {
    const result = fakeCloudflare.rejectToken ? undefined : answers[request.url ?? '']
    const errors = fakeCloudflare.rejectToken
      ? [{ code: 10000, message: 'Authentication error' }]
      : []

    response.writeHead(result ? 200 : 403, { 'content-type': 'application/json' })
    response.end(JSON.stringify(result ? { success: true, result } : { success: false, errors }))
  })

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  server.unref()

  return {
    CLOUDFLARE_API_URL: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    CLOUDFLARE_OAUTH_ADMIN_TOKEN: 'e2e-cloudflare-token-not-a-production-credential',
    CLOUDFLARE_OAUTH_CLIENT_ID: 'e2e-cloudflare-client',
    CLOUDFLARE_OAUTH_CLIENT_SECRET: 'e2e-cloudflare-secret-not-a-production-credential',
    CLOUDFLARE_OAUTH_SETUP_REDIRECT: `${apiUrl}/cloudflare-app/setup`,
  }
}
