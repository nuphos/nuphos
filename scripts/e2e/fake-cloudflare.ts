import { createServer } from 'node:http'

import type { AddressInfo } from 'node:net'

// Cloudflare's API as the backend's "OAuth Client Read" token sees it.
export async function fakeCloudflareApi(): Promise<string> {
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
    const result = answers[request.url ?? '']

    response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify(result ? { success: true, result } : { success: false }))
  })

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  server.unref()

  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}
