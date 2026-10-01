import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runDevCommand } from './dev-process.ts'

test('runDevCommand bounds a hung child process', async () => {
  const startedAt = Date.now()
  const result = await runDevCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 25,
  })

  assert.equal(result.exitCode, 124)
  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - startedAt < 2_000)
})

test('runDevCommand forwards output without shell interpolation', async () => {
  const output: string[] = []
  const result = await runDevCommand(process.execPath, ['-e', 'console.log("ready")'], {
    onStdout: (line) => output.push(line),
  })

  assert.equal(result.exitCode, 0)
  assert.equal(result.timedOut, false)
  assert.deepEqual(output, ['ready'])
})
