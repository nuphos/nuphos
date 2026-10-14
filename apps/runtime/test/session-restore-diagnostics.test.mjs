import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { nuphosTraceRestore } from '../image/runtime-defaults.mjs'

const id = '11111111-2222-4333-8444-555555555555'
const params = {
  _meta: {
    claudeCode: {
      options: {
        env: {
          NUPHOS_SESSION_ID: id,
          NUPHOS_TOKEN: 'secret-must-not-be-recorded',
        },
      },
    },
  },
}

test('a stalled restore leaves a private snapshot without request contents', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'restore-diagnostics-'))
  const previous = process.env.HOME
  process.env.HOME = home
  t.after(async () => {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    await rm(home, { recursive: true })
  })
  const file = join(
    home,
    '.nuphos',
    'session-homes',
    createHash('sha256').update(id).digest('hex'),
    'session-restore.json',
  )
  let release
  let started
  const entered = new Promise((resolve) => {
    started = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const restore = nuphosTraceRestore(params, 'loadSession', async (step) => {
    step('sdk-session')
    step('history-replay')
    started()
    await gate
    return 'original-result'
  })
  await entered
  const raw = await readFile(file, 'utf8')
  const pending = JSON.parse(raw)
  assert.equal(pending.phase, 'history-replay')
  assert.equal(pending.status, 'running')
  assert.equal(pending.sessionId, id)
  assert.ok(pending.attemptId)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.ok(!raw.includes('secret-must-not-be-recorded'))
  release()
  assert.equal(await restore, 'original-result')
  const complete = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(complete.status, 'completed')
  assert.equal(complete.attemptId, pending.attemptId)
  assert.ok(complete.elapsedMs >= pending.elapsedMs)

  const failure = new Error('Bearer secret-error-payload')
  await assert.rejects(
    nuphosTraceRestore(params, 'loadSession', async (step) => {
      step('sdk-session')
      throw failure
    }),
    (error) => error === failure,
  )
  const failedRaw = await readFile(file, 'utf8')
  const failed = JSON.parse(failedRaw)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.phase, 'sdk-session')
  assert.notEqual(failed.attemptId, complete.attemptId)
  assert.ok(!failedRaw.includes('secret-error-payload'))
  assert.equal(
    JSON.parse(await readFile(file.replace('.json', '.previous.json'), 'utf8')).attemptId,
    complete.attemptId,
  )
})

test('unavailable diagnostic storage preserves restore behavior', async (t) => {
  const previous = process.env.HOME
  process.env.HOME = '/dev/null/unwritable'
  t.after(() => {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  })
  assert.equal(await nuphosTraceRestore(params, 'resumeSession', async () => 42), 42)
  const failure = new Error('original')
  await assert.rejects(
    nuphosTraceRestore(params, 'resumeSession', async () => {
      throw failure
    }),
    (error) => error === failure,
  )
})
