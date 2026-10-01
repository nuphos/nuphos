import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LocalExecStream } from './exec-stream.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('one stream runs one command and sends its result once', async () => {
  const commands: string[] = []
  const results: unknown[] = []
  const stream = new LocalExecStream({
    runLocalCommand: async (command) => {
      commands.push(command)

      return { stdout: 'ok', stderr: '', exitCode: 0 }
    },
    abortClientTools: () => {},
  })

  stream.addEventListener('message', (event) => results.push(JSON.parse(String(event.data))))
  await tick()
  stream.send('echo ok')
  stream.send('duplicate must not run')
  await tick()
  assert.deepEqual(commands, ['echo ok'])
  assert.deepEqual(results, [{ stdout: 'ok', stderr: '', exitCode: 0 }])
  assert.equal(stream.readyState, 3)
})

test('logout or tunnel loss cancels a running command and suppresses late results', async () => {
  let commandId: string | undefined
  const aborted: string[] = []
  const results: unknown[] = []
  let finish: (result: { stdout: string; stderr: string; exitCode: number }) => void = () => {}
  const stream = new LocalExecStream({
    runLocalCommand: (_command, options) => {
      commandId = options?.sessionId

      return new Promise((resolve) => {
        finish = resolve
      })
    },
    abortClientTools: (id) => aborted.push(id),
  })

  stream.addEventListener('message', (event) => results.push(event.data))
  await tick()
  stream.send('sleep 30')
  stream.close()
  stream.close()
  finish({ stdout: 'late', stderr: '', exitCode: 0 })
  await tick()
  assert.deepEqual(aborted, [commandId])
  assert.deepEqual(results, [])
})

test('a stream closed before open never runs a buffered command', async () => {
  let commands = 0
  const stream = new LocalExecStream({
    runLocalCommand: async () => {
      commands++

      return { stdout: '', stderr: '', exitCode: 0 }
    },
    abortClientTools: () => {},
  })

  stream.close()
  await tick()
  stream.send('echo should-not-run')
  assert.equal(commands, 0)
})
