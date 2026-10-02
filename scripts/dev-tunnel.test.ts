import assert from 'node:assert/strict'
import test from 'node:test'

import { namedTunnelUrlFromConfig } from './dev-tunnel.ts'

const config = `
ingress:
  - hostname: api-dev-example-1.nuphos.ai
    service: http://localhost:3718
    originRequest:
      originServerName: local.zeabur.com
  - hostname: api-dev-example-2.nuphos.ai
    service: http://localhost:3719
  - service: http_status:404
`

test('namedTunnelUrlFromConfig resolves the hostname mapped to the backend port', () => {
  assert.equal(namedTunnelUrlFromConfig(config, 3718), 'https://api-dev-example-1.nuphos.ai')
  assert.equal(namedTunnelUrlFromConfig(config, 3719), 'https://api-dev-example-2.nuphos.ai')
})

test('namedTunnelUrlFromConfig does not invent a hostname for an unmapped port', () => {
  assert.equal(namedTunnelUrlFromConfig(config, 3720), null)
})

test('HTTPS origins are not reused for the HTTP local backend', () => {
  const tlsConfig = config.replaceAll(
    'service: http://localhost:',
    'service: https://local.zeabur.com:',
  )

  assert.equal(namedTunnelUrlFromConfig(tlsConfig, 3718), null)
})
