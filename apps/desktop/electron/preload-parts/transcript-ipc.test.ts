// The whole tab transcript must never cross IPC into the main process: copying
// it into the main heap on every turn ran the main process out of memory. The
// preload sends only the current turn's tail.
import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { agentApi as AgentApi } from './api-agent.ts'
import type { cloudOpsApi as CloudOpsApi } from './api-cloud-ops.ts'

const invoked: { channel: string; args: { messages: { id: string }[]; baseIndex?: number } }[] = []
let cloudOpsApi: typeof CloudOpsApi
let agentApi: typeof AgentApi

before(async () => {
  mock.module('electron', {
    namedExports: {
      ipcRenderer: {
        invoke: async (channel: string, args: (typeof invoked)[number]['args']) => {
          invoked.push({ channel, args })
        },
      },
    },
  })
  ;({ cloudOpsApi } = await import('./api-cloud-ops.ts'))
  ;({ agentApi } = await import('./api-agent.ts'))
})

const transcript = Array.from({ length: 200 }, (_, i) => ({
  id: `m${String(i)}`,
  role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
  parts: [],
}))

test('agent:start carries only the tail from the latest user message', async () => {
  invoked.length = 0
  await cloudOpsApi.agentStart({
    streamId: 's',
    sessionId: 'sess',
    messages: transcript,
    baseIndex: 10,
  })

  assert.equal(invoked[0]?.channel, 'agent:start')
  assert.deepEqual(
    invoked[0]?.args.messages.map((m) => m.id),
    ['m198', 'm199'],
  )
  assert.equal(invoked[0]?.args.baseIndex, 208)
})

test('transcript sync carries only the tail, an import goes whole', async () => {
  invoked.length = 0
  await agentApi.agentSyncConversationTranscript({
    sessionId: 'sess',
    title: 't',
    messages: transcript,
  })
  await agentApi.agentSyncConversationTranscript({
    sessionId: 'sess',
    title: 't',
    messages: transcript,
    import: true,
  })

  assert.deepEqual(
    invoked[0]?.args.messages.map((m) => m.id),
    ['m198', 'm199'],
  )
  assert.equal(invoked[0]?.args.baseIndex, 198)
  assert.equal(invoked[1]?.args.messages.length, 200)
})
