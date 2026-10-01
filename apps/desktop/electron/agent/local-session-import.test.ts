import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, mock, test } from 'node:test'

let importLocalSession: typeof import('./local-session-import.ts').importLocalSession
const calls: { method: string; route: string; body: unknown }[] = []
const originalHome = process.env.HOME
let sessionPath: string

before(async () => {
  // A real session log under a temp HOME, so the import goes through the same
  // listing the composer menu shows instead of a mocked allow-list.
  const home = mkdtempSync(path.join(os.tmpdir(), 'import-home-'))

  process.env.HOME = home
  const projects = path.join(home, '.claude', 'projects', 'repo')

  mkdirSync(projects, { recursive: true })
  sessionPath = path.join(projects, 'a.jsonl')
  writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Scale the cluster' } })}\n`,
  )
  mock.module('./http.ts', {
    namedExports: {
      callJson: (method: string, route: string, body: unknown) => {
        calls.push({ method, route, body })

        return Promise.resolve({ ok: true })
      },
      teamQuery: (teamId?: string) => (teamId ? `?teamId=${teamId}` : ''),
    },
  })
  ;({ importLocalSession } = await import('./local-session-import.ts'))
})

after(() => {
  process.env.HOME = originalHome
})

const args = { teamId: 'team', runtimeId: 'runtime-1', agentRuntime: 'claude-code' as const }

test('refuses an id the session list does not contain', async () => {
  await assert.rejects(
    () => importLocalSession({ source: 'claude-code', id: '/etc/passwd', ...args }),
    /recent sessions/u,
  )
  assert.equal(calls.length, 0)
})

test('imports a listed session as a new conversation stamped with the runtime', async () => {
  const result = await importLocalSession({ source: 'claude-code', id: sessionPath, ...args })

  assert.equal(result.messageCount, 1)
  assert.equal(result.title, 'Scale the cluster')
  assert.equal(calls.length, 1)
  const call = calls[0]
  const body = call?.body as {
    runtimeId: string
    agentRuntime: string
    baseIndex?: number
    messages: { role: string }[]
  }

  assert.equal(call?.method, 'PUT')
  assert.equal(
    call?.route,
    `/agent/conversations/${encodeURIComponent(result.sessionId)}/transcript?teamId=team`,
  )
  assert.equal(body.runtimeId, 'runtime-1')
  assert.equal(body.agentRuntime, 'claude-code')
  // A fresh conversation must carry the whole transcript, never a windowed tail.
  assert.equal(body.baseIndex, undefined)
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ['user'],
  )
})
