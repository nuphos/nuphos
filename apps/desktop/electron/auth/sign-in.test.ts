import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { Config } from './config.ts'

const saved: Config[] = []

mock.module('./config.ts', {
  namedExports: {
    writeConfig: (cfg: Config) => {
      saved.push(cfg)

      return Promise.resolve()
    },
  },
})

process.env.NUPHOS_API_URL = 'https://api.nuphos.ai'
const { apiUrl, loginApiUrl, stageLoginApiUrl } = await import('../api-endpoint.ts')
const { cancelSignIn, saveSignIn, signInAttempt } = await import('./sign-in.ts')

const USER = { id: 'u9', name: 'Other', email: 'other@example.com', username: 'other' }

test('a sign-in cancelled before it completes is not saved', async () => {
  saved.length = 0
  const attempt = signInAttempt()

  cancelSignIn()
  await assert.rejects(saveSignIn(attempt, { token: 'late', userInfo: USER }), /cancelled/)
  assert.deepEqual(saved, [])
})

test('a sign-in on a staged backend is saved there, leaving the current backend until then', async () => {
  saved.length = 0
  stageLoginApiUrl('https://nuphos.example.com/path')

  assert.equal(apiUrl(), 'https://api.nuphos.ai')
  assert.equal(loginApiUrl(), 'https://nuphos.example.com')
  await saveSignIn(signInAttempt(), { token: 'tok', userInfo: USER })

  assert.equal(saved[0]?.apiUrl, 'https://nuphos.example.com')
  assert.equal(loginApiUrl(), apiUrl())
})

test('a sign-in is saved on the backend it started on, even if another is staged meanwhile', async () => {
  saved.length = 0
  stageLoginApiUrl('https://b.example.com')
  const attempt = signInAttempt()

  stageLoginApiUrl('https://c.example.com')
  await saveSignIn(attempt, { token: 'tok-b', userInfo: USER })

  assert.equal(saved[0]?.apiUrl, 'https://b.example.com')
})

test('staging the current backend stages nothing', () => {
  assert.equal(stageLoginApiUrl('https://api.nuphos.ai/'), 'https://api.nuphos.ai')
  assert.equal(loginApiUrl(), apiUrl())
})
