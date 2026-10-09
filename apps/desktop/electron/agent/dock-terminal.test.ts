import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'

import type { WebContents } from 'electron'

const frames: { id: string; teamId: string; sessionId: string }[] = []
const starts: unknown[][] = []
const writes: unknown[][] = []
const owner = {} as WebContents

mock.module('electron', {
  namedExports: {
    BrowserWindow: {
      getAllWindows: () => [
        {
          webContents: {
            send: (_channel: string, request: (typeof frames)[number]) => frames.push(request),
          },
        },
      ],
    },
  },
})
mock.module('../local-terminal.ts', {
  namedExports: {
    localTerminals: {
      start: (...args: unknown[]) => starts.push(args),
      agentRequest: (...args: unknown[]) => {
        writes.push(args)

        return { terminalId: args[0], output: 'hello' }
      },
    },
  },
})

const { runDockTerminal, acceptDockTerminal, abortDockTerminal } =
  await import('./dock-terminal.ts')
const request = (action: string, rest = {}) =>
  JSON.stringify({ action, teamId: 't1', sessionId: 's1', ...rest })

beforeEach(() => {
  frames.length = 0
  starts.length = 0
  writes.length = 0
})

test('only one renderer can claim a request and start its scoped PTY', async () => {
  const result = runDockTerminal(request('open', { cwd: '/tmp' }), { sessionId: 'exec1' })
  const frame = frames[0]!

  assert.equal(starts.length, 0)
  assert.equal(frame.sessionId, 's1')
  assert.equal(acceptDockTerminal(owner, frame.id), true)
  assert.equal(acceptDockTerminal(owner, frame.id), false)
  assert.deepEqual(starts, [[owner, frame.id, 80, 24, '/tmp', '["t1","s1"]']])
  assert.deepEqual(JSON.parse((await result).stdout), { terminalId: frame.id })
})

test('disconnect cancels an unclaimed request and a late renderer cannot spawn', async () => {
  const result = runDockTerminal(request('open'), { sessionId: 'exec2' })

  abortDockTerminal('exec2')
  assert.equal(acceptDockTerminal(owner, frames[0]!.id), false)
  assert.equal((await result).exitCode, 1)
  assert.equal(starts.length, 0)
})

test('writes and interrupts use the conversation scope and read does not send input', async () => {
  for (const action of ['write', 'interrupt', 'read']) {
    const result = await runDockTerminal(
      request(action, { terminalId: 'tab1', data: 'echo hi\r' }),
      { sessionId: 'exec3' },
    )

    assert.equal(result.exitCode, 0)
  }
  assert.deepEqual(writes, [
    ['tab1', '["t1","s1"]', 'echo hi\r'],
    ['tab1', '["t1","s1"]', '\x03'],
    ['tab1', '["t1","s1"]', undefined],
  ])
})
