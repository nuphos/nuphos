import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.E2E_ARTIFACTS = mkdtempSync(join(tmpdir(), 'nuphos-e2e-log-'))
const { backendFailures } = await import('./backend-log.ts')

const log = (lines: object[]) =>
  writeFileSync(
    join(process.env.E2E_ARTIFACTS ?? '', 'backend.log'),
    lines.map((line) => JSON.stringify(line)).join('\n'),
  )

// #3684: a resume that lost the race with a finished stream, which Desktop starts afresh from.
test('a stream that is no longer resumable is not a backend failure', () => {
  log([
    {
      level: 'warn',
      event: 'agent.chat.resume.redis_not_resumable',
      error_status: 409,
      error_code: 'stream_not_resumable',
    },
    { level: 'info', event: 'http.request', status: 409, error_code: 'stream_not_resumable' },
    {
      level: 'warn',
      event: 'agent.chat.client_breadcrumb',
      status: 409,
      code: 'stream_not_resumable',
      client_phase: 'fresh_start_fallback',
    },
  ])
  assert.deepEqual(backendFailures(0), [])
})

test('any other refused request still is', () => {
  log([{ level: 'info', event: 'http.request', status: 409, error_code: 'conflict' }])
  assert.equal(backendFailures(0).length, 1)
})
