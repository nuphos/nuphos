import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

let fetches = 0
let answer: () => Promise<unknown> = async () => ({
  githubInstallations: [{ installationId: 'gh' }],
})

mock.module('../../../api.ts', {
  namedExports: {
    api: {
      agentGetCredentialOptions: () => {
        fetches += 1

        return answer()
      },
    },
  },
})

const { EMPTY_CREDENTIAL_OPTIONS } = await import('./constants.ts')
const { storedConversationCredentialAccess } = await import('./conversationCredentialAccess.ts')
const { normalizeCredentialOptions } = await import('./credentialAccess.ts')
const { loadedCredentialOptions } = await import('./loadedCredentialOptions.ts')

// #3259: a conversation opened before the options loaded kept a selection read
// against nothing, which showed its team-wide kinds off.
test('a conversation opened before the options load reads its selection against loaded ones', async () => {
  const options = await loadedCredentialOptions('team', EMPTY_CREDENTIAL_OPTIONS)

  assert.deepEqual(storedConversationCredentialAccess(null, options).githubInstallationIds, ['gh'])
})

test('options already loaded are not fetched again', async () => {
  const loaded = normalizeCredentialOptions({})
  const before = fetches

  assert.equal(await loadedCredentialOptions('team', loaded), loaded)
  assert.equal(fetches, before)
})

test('a failed load opens with the options as they were', async () => {
  answer = () => Promise.reject(new Error('offline'))

  assert.equal(
    await loadedCredentialOptions('team', EMPTY_CREDENTIAL_OPTIONS),
    EMPTY_CREDENTIAL_OPTIONS,
  )
})
