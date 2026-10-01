import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentRow,
  bundleDir,
  devStatusPath,
  failureReason,
  missingTools,
} from './dev-local-agent.ts'

test('the row reports each phase of preparing the local agent', () => {
  assert.equal(agentRow({ kind: 'checking' }).status, 'starting')
  assert.match(
    agentRow({ kind: 'preparing', why: 'missing' }).note ?? '',
    /preparing the local agent/,
  )
  assert.match(agentRow({ kind: 'preparing', why: 'stale' }).note ?? '', /pins changed/)
  assert.deepEqual(agentRow({ kind: 'ready' }), {
    status: 'ready',
    note: 'local agent ready',
    health: {},
  })
  assert.match(agentRow({ kind: 'ready', seconds: 42 }).note ?? '', /42s/)
})

test('a failed prepare shows its reason and how to retry without failing the launcher', () => {
  const row = agentRow({ kind: 'failed', reason: 'Error: HTTP 404' })

  assert.equal(row.status, 'crashed')
  assert.match(row.note ?? '', /press r/)
  assert.equal(row.health.reason, 'Error: HTTP 404')
})

test('missing build tools degrade the row with what to install', () => {
  const tools = missingTools((command) => command !== 'cargo')

  assert.deepEqual(tools, ['Rust toolchain (https://rustup.rs)'])
  const row = agentRow({ kind: 'missing-tools', tools })

  assert.equal(row.status, 'degraded')
  assert.match(row.health.install ?? '', /rustup\.rs/)
  assert.deepEqual(
    missingTools(() => true),
    [],
  )
  assert.deepEqual(
    missingTools(() => false, true),
    ['npm'],
  )
})

test('the failure reason is the error line, else the last output', () => {
  assert.equal(
    failureReason(['compiling', '\x1b[31mError: No openab binary\x1b[0m', 'at prepare'], 1),
    'Error: No openab binary',
  )
  assert.equal(failureReason(['a', 'last words', ''], 1), 'last words')
  assert.equal(failureReason([], 7), 'prepare.mjs exited with code 7')
})

test('the desktop reads the launcher status beside the host bundle', () => {
  const dir = bundleDir('/repo/apps/desktop', 'darwin-arm64')

  assert.equal(dir, '/repo/apps/desktop/build/local-runtime/darwin-arm64')
  assert.equal(devStatusPath(dir), `${dir}.dev.json`)
})
