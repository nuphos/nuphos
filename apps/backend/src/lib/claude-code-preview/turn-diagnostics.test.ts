import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { OpenAbTimeoutError, turnDiagnostics } from './turn-diagnostics'

const base = { streamId: 'run', startedAt: 1000, endedAt: 1801000, toolSteps: [] }

test('a runtime hard timeout preserves its threshold without inventing deadline semantics', () => {
  const result = turnDiagnostics({
    ...base,
    lastProgressAt: 1800000,
    error: new OpenAbRpcError('Agent exceeded hard timeout (1800s)', -32603),
    buildSha: 'abc123',
    adapterVersion: 'codex-acp@1.1.4',
    toolSteps: [{ toolCallId: 'tool', toolName: 'Terminal', input: { token: 'not-persisted' } }],
  })

  expect(result).toMatchObject({
    source: 'runtime',
    timeoutKind: 'runtime-reported-unknown',
    timeoutMs: 1800000,
    elapsedMs: 1800000,
    progressSilenceMs: 1000,
    errorCode: -32603,
    buildSha: 'abc123',
    lastTool: { status: 'pending' },
  })
  expect(JSON.stringify(result)).not.toContain('not-persisted')
})

test('backend timeouts preserve the configured kind and window', () => {
  expect(
    turnDiagnostics({ ...base, error: new OpenAbTimeoutError('deadline', 'progress', 1234) }),
  ).toMatchObject({ source: 'backend', timeoutKind: 'progress', timeoutMs: 1234 })
  expect(turnDiagnostics({ ...base, aborted: true, error: new Error('stop') }).source).toBe(
    'cancel',
  )
})

test('missing progress/build stays unknown, and secrets in errors are redacted', () => {
  const result = turnDiagnostics({
    ...base,
    error: new Error('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'),
  })

  expect(result.lastProgressAt).toBeUndefined()
  expect(result.buildSha).toBeUndefined()
  expect(result.error).not.toContain('abcdefghijklmnopqrstuvwxyz')
})

test('the turn retains its observed runtime build after disconnection', async () => {
  const { createTurnDiagnostics } = await import('./turn-diagnostics')
  let connected = true
  const tracker = createTurnDiagnostics({ streamId: 'run', startedAt: Date.now() }, () => ({
    ...(connected ? { buildSha: 'old-build', adapterVersion: 'adapter-v1' } : {}),
    toolSteps: () => [],
    aborted: false,
  }))

  tracker.progress()
  connected = false
  expect(tracker.finish(new Error('connection closed'))).toMatchObject({
    buildSha: 'old-build',
    adapterVersion: 'adapter-v1',
    lastProgressAt: expect.any(String),
  })
})
