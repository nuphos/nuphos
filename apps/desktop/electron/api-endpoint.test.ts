import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-endpoint-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.dev.test.yaml')
process.env.NUPHOS_API_URL = 'http://127.0.0.1:3718'
delete process.env.ATLAS_API_URL

const { apiUrl, setApiUrl } = await import('./api-endpoint.ts')

test('resetting the endpoint returns to the launch-time one, not Nuphos Cloud', () => {
  assert.equal(setApiUrl('https://nuphos.example.com/path'), 'https://nuphos.example.com')
  assert.equal(setApiUrl(null), 'http://127.0.0.1:3718')
  assert.equal(apiUrl(), 'http://127.0.0.1:3718')
  assert.equal(process.env.NUPHOS_API_URL, 'http://127.0.0.1:3718')
  assert.equal(fs.existsSync(path.join(dir, 'cli.dev.test.api-url')), false)
})
