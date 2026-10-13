import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { OpenAbTimeoutError, turnDiagnostics } from './turn-diagnostics'

const base = { streamId: 'run', startedAt: 1000, endedAt: 1801000, toolSteps: [] }

test('a runtime hard timeout preserves its threshold without inventing deadline semantics', () => {
  const result = turnDiagnostics({
    ...base,
    lastOutputAt: 1800000,
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
    outputSilenceMs: 1000,
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
  expect(turnDiagnostics({ ...base, aborted: true, error: new Error('stop') }).source).toBe('abort')
})

test('missing progress/build stays unknown, and secrets in errors are redacted', () => {
  const result = turnDiagnostics({
    ...base,
    error: new Error('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'),
  })

  expect(result.lastOutputAt).toBeUndefined()
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

  tracker.observe()
  tracker.progress()
  connected = false
  expect(tracker.finish(new Error('connection closed'))).toMatchObject({
    buildSha: 'old-build',
    adapterVersion: 'adapter-v1',
    lastOutputAt: expect.any(String),
  })
})

test('write-side bounds match the reader instead of losing the whole record', async () => {
  const { transcriptTurnDiagnostics } = await import('@/lib/agent/db/transcript-diagnostics')
  const data = turnDiagnostics({
    ...base,
    streamId: 's'.repeat(500),
    runtimeId: 'r'.repeat(500),
    buildSha: 'b'.repeat(500),
    adapterVersion: 'adapter'.repeat(500),
    error: new Error('deadline'),
    toolSteps: [{ toolCallId: 't'.repeat(500), toolName: 'Terminal', input: {} }],
  })

  expect(data.streamId).toHaveLength(128)
  expect(data.lastTool?.toolCallId).toHaveLength(200)
  expect(
    transcriptTurnDiagnostics({
      index: 1,
      role: 'assistant',
      parts: [{ type: 'turn-interrupted', diagnostics: data }],
    })[0]?.diagnostics,
  ).toEqual(data)
})

test('output tracking does not probe the registry on each delta when no build is known', async () => {
  const { createTurnDiagnostics } = await import('./turn-diagnostics')
  let probes = 0
  const tracker = createTurnDiagnostics({ streamId: 'run', startedAt: Date.now() }, () => {
    probes++

    return { toolSteps: () => [], aborted: false }
  })

  for (let i = 0; i < 100; i++) tracker.progress()
  expect(probes).toBe(0)
  tracker.finish(new Error('failed'))
  expect(probes).toBe(1)
})
