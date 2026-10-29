import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-endpoint-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.dev.test.yaml')
process.env.NUPHOS_API_URL = 'http://127.0.0.1:3718'
delete process.env.ATLAS_API_URL

const { apiUrl, setApiUrl, deviceRegistrationAllowed } = await import('./api-endpoint.ts')
const { authSession } = await import('./auth-session.ts')

test('resetting the endpoint returns to the launch-time one, not Nuphos Cloud', () => {
  assert.equal(setApiUrl('https://nuphos.example.com/path'), 'https://nuphos.example.com')
  assert.equal(setApiUrl(null), 'http://127.0.0.1:3718')
  assert.equal(apiUrl(), 'http://127.0.0.1:3718')
  assert.equal(process.env.NUPHOS_API_URL, 'http://127.0.0.1:3718')
  assert.equal(fs.existsSync(path.join(dir, 'cli.dev.test.api-url')), false)
})

test('dev devices stay off Cloud, including normalized hostnames and alternate ports', () => {
  for (const url of [
    'https://api.nuphos.ai',
    'https://API.NUPHOS.AI/',
    'https://api.nuphos.ai.:443/path',
    'http://api.nuphos.ai:8080',
  ]) {
    setApiUrl(url)
    assert.equal(deviceRegistrationAllowed(true), false, url)
    assert.equal(deviceRegistrationAllowed(false), true, 'installed Desktop still registers')
  }
  for (const url of ['http://127.0.0.1:3718', 'http://localhost:3718', 'https://dev.example.com']) {
    setApiUrl(url)
    assert.equal(deviceRegistrationAllowed(true), true, url)
  }
  setApiUrl(null)
  assert.equal(deviceRegistrationAllowed(true), true)
})

test('endpoint changes notify runtime listeners after the new endpoint takes effect', () => {
  setApiUrl(null)
  const allowed: boolean[] = []
  const unsubscribe = authSession.subscribe(() => allowed.push(deviceRegistrationAllowed(true)))

  setApiUrl('https://api.nuphos.ai')
  setApiUrl('https://api.nuphos.ai/')
  setApiUrl(null)
  assert.deepEqual(allowed, [false, true])
  unsubscribe()
  setApiUrl('https://api.nuphos.ai')
  assert.deepEqual(allowed, [false, true])
  setApiUrl(null)
})
