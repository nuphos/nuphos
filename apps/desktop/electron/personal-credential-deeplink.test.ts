import assert from 'node:assert/strict'
import { test } from 'node:test'

import { completePersonalCredentialUrl } from './personal-credential-deeplink.ts'

const never = () => Promise.reject(new Error('should not be called'))

test('claims the staged grant with the one-time code', async () => {
  const calls: string[][] = []
  const result = await completePersonalCredentialUrl(
    'nuphos://personal-credential?provider=github&state=s&code=c',
    (provider, state, code) => {
      calls.push([provider, state, code])

      return Promise.resolve({ provider, login: 'fong', workspaceName: null, connectedAt: 'now' })
    },
  )

  assert.deepEqual(calls, [['github', 's', 'c']])
  assert.deepEqual(result, { provider: 'github', login: 'fong' })
})

test('passes a provider error through without completing', async () => {
  const result = await completePersonalCredentialUrl(
    'nuphos://personal-credential?provider=linear&error=access_denied',
    never,
  )

  assert.deepEqual(result, { provider: 'linear', error: 'access_denied' })
})

test('reports the backend error code of a failed claim', async () => {
  const err = new Error(
    `__ATLAS_API_ERROR__${JSON.stringify({ message: 'gone', code: 'oauth_not_ready' })}`,
  )
  const result = await completePersonalCredentialUrl(
    'nuphos://personal-credential?provider=github&state=s&code=c',
    () => Promise.reject(err),
  )

  assert.deepEqual(result, { provider: 'github', error: 'oauth_not_ready' })
})

test('ignores unknown providers and other links', async () => {
  assert.equal(
    await completePersonalCredentialUrl('nuphos://personal-credential?provider=x', never),
    null,
  )
  assert.equal(await completePersonalCredentialUrl('nuphos://open', never), null)
})
