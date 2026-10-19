import assert from 'node:assert/strict'
import { test } from 'node:test'

import { connectorCallbackParams } from './connector-oauth-callback.ts'

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
