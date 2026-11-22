import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { CloudflareOAuthResult } from './atlas/cf-dns.ts'

let pollResult: CloudflareOAuthResult = { ready: false }
let startInstall: typeof import('./cloudflare-install.ts').startInstall

before(async () => {
  mock.module('electron', { namedExports: { shell: { openExternal: () => Promise.resolve() } } })
  mock.module('./atlas.ts', {
    namedExports: {
      startCloudflareOAuth: () => Promise.resolve({ authorizeUrl: 'https://cf/auth', state: 's' }),
      pollCloudflareOAuthResult: () => Promise.resolve(pollResult),
      cancelCloudflareOAuth: () => Promise.resolve(),
    },
  })
  ;({ startInstall } = await import('./cloudflare-install.ts'))
})

test('a rejection reported only through the poll fails the connect with its reason', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  pollResult = {
    ready: false,
    error: 'invalid_scope',
    errorDescription: "The OAuth 2.0 Client is not allowed to request scope 'dns-firewall.read'.",
  }
  const install = startInstall('team', ['dns-firewall.read'])
  const outcome = install.then(
    () => 'resolved',
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  )

  await new Promise((r) => setImmediate(r))
  t.mock.timers.tick(2500)
  await new Promise((r) => setImmediate(r))

  const settled = await Promise.race([outcome, Promise.resolve('still waiting')])

  assert.match(settled, /not allowed to request scope 'dns-firewall\.read'/)
})
