import assert from 'node:assert/strict'
import test from 'node:test'

import { namedTunnelUrlFromConfig } from './dev-tunnel.ts'

const config = `
ingress:
  - hostname: api-dev-yuanlin-1.nuphos.ai
    service: https://local.zeabur.com:3718
    originRequest:
      originServerName: local.zeabur.com
  - hostname: api-dev-yuanlin-2.nuphos.ai
    service: https://local.zeabur.com:3719
  - service: http_status:404
`

test('namedTunnelUrlFromConfig resolves the hostname mapped to the backend port', () => {
  assert.equal(namedTunnelUrlFromConfig(config, 3718), 'https://api-dev-yuanlin-1.nuphos.ai')
  assert.equal(namedTunnelUrlFromConfig(config, 3719), 'https://api-dev-yuanlin-2.nuphos.ai')
})

test('namedTunnelUrlFromConfig does not invent a hostname for an unmapped port', () => {
  assert.equal(namedTunnelUrlFromConfig(config, 3720), null)
})
