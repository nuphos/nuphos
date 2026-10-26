import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-registration-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'http://127.0.0.1:3718'
delete process.env.ATLAS_API_URL
mock.module('./env.ts', { namedExports: { isDev: true } })
mock.module('./device-identity.ts', {
  namedExports: {
    readDeviceIdentity: () => ({ deviceId: 'dev-device', label: 'M5', createdAt: '' }),
    setDeviceLabel: () => {
      throw new Error('not used')
    },
  },
})
mock.module('../agent/local-exec.ts', {
  namedExports: { logLocalTool: () => {}, normalizeToolError: String },
})
mock.module('../auth/config.ts', {
  namedExports: {
    requestContext: async () => ({
      ...(await import('../auth-session.ts')).authSession.context(),
      token: 'test-token',
    }),
  },
})
mock.module('../fetch-error.ts', {
  namedExports: { tagRequest: () => 'test-request', backendFailure: (e: unknown) => e },
})

const { setApiUrl } = await import('../api-endpoint.ts')
const { setTokenSource } = await import('../agent/http.ts')
const { syncDeviceRegistration } = await import('./device-controller.ts')
const requests: string[] = []

mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
  requests.push(String(url))

  return Response.json({ ok: true })
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('a dev Desktop registers locally, but never when its endpoint is Cloud', async () => {
  setApiUrl(null)
  await syncDeviceRegistration()
  assert.deepEqual(requests.splice(0), ['http://127.0.0.1:3718/agent/devices'])
  setApiUrl('https://api.nuphos.ai')
  await syncDeviceRegistration()
  assert.deepEqual(requests, [])
})

test('switching to Cloud while machine metadata is pending cancels registration', async () => {
  setApiUrl(null)
  const registration = syncDeviceRegistration()

  setApiUrl('https://api.nuphos.ai')
  await registration
  assert.deepEqual(requests, [])
})

test('an in-flight registration cannot be redirected to Cloud while reading the token', async () => {
  setApiUrl(null)
  let resolveToken!: (token: string) => void
  let tokenRead!: () => void
  const token = new Promise<string>((resolve) => {
    resolveToken = resolve
  })
  const readingToken = new Promise<void>((resolve) => {
    tokenRead = resolve
  })

  setTokenSource(() => {
    tokenRead()

    return token
  })
  const registration = syncDeviceRegistration()

  await readingToken
  setApiUrl('https://api.nuphos.ai')
  resolveToken('test-token')
  await registration
  assert.deepEqual(requests, ['http://127.0.0.1:3718/agent/devices'])
})
