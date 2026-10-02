import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBackend } from './dev-backend.ts'
import { backend } from './dev-services.ts'

test('the listening event publishes the same HTTP port to Desktop', () => {
  backend.url = 'https://local.zeabur.com:3718'
  parseBackend(JSON.stringify({ event: 'backend.server.listening', protocol: 'http', port: 3720 }))
  assert.equal(backend.url, 'http://localhost:3720')
  assert.equal(backend.port, 3720)
})
