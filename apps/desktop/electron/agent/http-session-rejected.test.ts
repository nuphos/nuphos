import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-http-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'https://a.example.test'
mock.module('../client-version.ts', {
  namedExports: { CLIENT_VERSION_HEADER: 'x-test', CLIENT_VERSION_VALUE: 'test' },
})

const { authSession } = await import('../auth-session.ts')
const { AtlasHttpError, callJson } = await import('./http.ts')
const { isSessionRejected } = await import('../../src/api/errors.ts')

mock.method(globalThis, 'fetch', async () =>
  Response.json(
    { error: { code: 'unauthorized', message: 'Invalid or expired token' } },
    { status: 401 },
  ),
)
after(() => fs.rmSync(dir, { recursive: true, force: true }))

// What ipcRenderer.invoke rejects with: a new Error carrying only the message.
function acrossIpc(channel: string, error: unknown): Error {
  return new Error(`Error invoking remote method '${channel}': ${String(error)}`)
}

test('an agent route refused for a dead session reads as rejected in the renderer', async () => {
  authSession.set('tok-a', 'a')
  const error = await callJson('GET', '/agent/conversations?teamId=t').catch((e: unknown) => e)

  assert.ok(error instanceof AtlasHttpError)
  assert.equal(error.status, 401)
  assert.equal(error.code, 'unauthorized')
  assert.equal(isSessionRejected(acrossIpc('agent:listConversations', error)), true)
})
