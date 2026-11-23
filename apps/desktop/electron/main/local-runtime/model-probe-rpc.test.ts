import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { adapterRpc } from './model-probe-rpc.ts'
import { probeLocalModels } from './model-probe.ts'

import type { ChildProcess } from 'node:child_process'

/** Runs a probe against an adapter script, collecting anything that escaped as uncaught. */
async function probeWith(source: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'model-probe-rpc-'))
  const adapter = path.join(dir, 'adapter.mjs')
  const escaped: unknown[] = []
  const onUncaught = (error: unknown) => escaped.push(error)

  writeFileSync(adapter, source)
  process.on('uncaughtException', onUncaught)
  try {
    const started = Date.now()
    const outcome = await probeLocalModels({
      nodeExecPath: process.execPath,
      adapter,
      cwd: dir,
      env: {},
    }).then(
      () => 'resolved',
      (error: unknown) => error,
    )

    // Let a late EPIPE surface, if anything was left unguarded.
    await new Promise((resolve) => setTimeout(resolve, 200))

    return { outcome, escaped, elapsed: Date.now() - started }
  } finally {
    process.off('uncaughtException', onUncaught)
    rmSync(dir, { recursive: true, force: true })
  }
}

test('an adapter that exits at once fails the probe instead of crashing the app', async () => {
  const { outcome, escaped } = await probeWith('process.exit(1)')

  assert.ok(outcome instanceof Error)
  assert.deepEqual(escaped, [])
})

test('an adapter that closes its input (EPIPE on write) fails the probe', async () => {
  const { outcome, escaped, elapsed } = await probeWith(
    `
    import { closeSync } from 'node:fs';
    closeSync(0);
    // Ask the client something, so its reply is written to the closed input.
    console.log(JSON.stringify({ id: 99, method: 'session/request_permission', params: {} }));
    setTimeout(() => {}, 20_000);
  `,
  )

  assert.ok(outcome instanceof Error)
  assert.deepEqual(escaped, [])
  // Failed as soon as the write did, not at the 30 s probe timeout.
  assert.ok(elapsed < 10_000, `took ${elapsed} ms`)
})

test('an adapter that dies mid-probe rejects the request it never answered', async () => {
  const { outcome, escaped, elapsed } = await probeWith(`
    import readline from 'node:readline';
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const { id, method } = JSON.parse(line);
      if (method !== 'initialize') process.exit(3);
      console.log(JSON.stringify({ id, result: {} }));
    }
  `)

  assert.ok(outcome instanceof Error)
  assert.match(outcome.message, /exited|reach|closed/)
  assert.deepEqual(escaped, [])
  assert.ok(elapsed < 10_000, `took ${elapsed} ms`)
})

function fakeChild() {
  const child = new EventEmitter() as ChildProcess
  const stdin = new PassThrough()

  Object.assign(child, { stdin, stdout: new PassThrough() })

  return { child, stdin }
}

test('a closed input fails once, and stopping rejects what is still waiting', async () => {
  const { child, stdin } = fakeChild()
  const failures: Error[] = []
  const rpc = adapterRpc(child, (error) => failures.push(error))
  const waiting = rpc.call('initialize', {})

  stdin.destroy()
  const refused = rpc.call('session/new', {})

  child.emit('exit', 1)
  stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
  assert.equal(failures.length >= 1, true)
  rpc.stop(failures[0] ?? new Error('stopped'))
  await assert.rejects(waiting)
  await assert.rejects(refused)
  await assert.rejects(rpc.call('session/set_config_option', {}))
  const reported = failures.length

  child.emit('error', new Error('late'))
  assert.equal(failures.length, reported)
})
