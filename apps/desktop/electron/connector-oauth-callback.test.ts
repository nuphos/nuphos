import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideErrorToast } from '../src/api/errors.ts'

import { buildAtlasError } from './atlas/error.ts'
import { connectorCallbackError, connectorCallbackParams } from './connector-oauth-callback.ts'

const never = () => Promise.reject(new Error('should not be called'))

test('passes through deep links from a backend that binds immediately', async () => {
  const url = new URL('nuphos://linear-callback?state=s&binding_id=b')
  const params = await connectorCallbackParams(url, 't', never)

  assert.equal(params.get('binding_id'), 'b')
})

test('completes a staged grant with the one-time code', async () => {
  const calls: string[][] = []
  const url = new URL('nuphos://linear-callback?state=s&deferred=1&code=c')
  const params = await connectorCallbackParams(url, 't', (teamId, state, code) => {
    calls.push([teamId, state, code])

    return Promise.resolve({ binding_id: 'b', team_id: 't' })
  })

  assert.deepEqual(calls, [['t', 's', 'c']])
  assert.equal(params.get('binding_id'), 'b')
})

test('turns a failed completion into an error the install flow reports', async () => {
  const url = new URL('nuphos://linear-callback?state=s&deferred=1&code=c')
  const params = await connectorCallbackParams(url, 't', () => Promise.reject(new Error('gone')))

  assert.equal(params.get('error'), 'complete_failed')
  assert.equal(params.get('error_description'), 'gone')
})

test("a provider's refusal reaches the connect toast instead of the generic fallback", () => {
  const params = new URLSearchParams({
    error: 'access_denied',
    error_description: 'The user denied access',
  })

  assert.deepEqual(decideErrorToast(connectorCallbackError('Cloudflare', params)), {
    action: 'show',
    description: 'Cloudflare OAuth failed: The user denied access',
  })
})

test("a failed completion shows the backend's own message", async () => {
  const url = new URL('nuphos://cloudflare-callback?state=s&deferred=1&code=c')
  const params = await connectorCallbackParams(url, 't', () =>
    Promise.reject(
      buildAtlasError('No approved connection is waiting for this request', 'oauth_not_ready'),
    ),
  )

  assert.deepEqual(decideErrorToast(connectorCallbackError('Cloudflare', params)), {
    action: 'show',
    description: 'No approved connection is waiting for this request',
  })
})
