// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import type { PreviewChatTurnArgs } from './chat-preview-turn'

let written: Record<string, unknown>[] = []
let cleared: string[] = []
let resolved: string[][] = []
let writeFails = false
let clearFails = false

useAgentDb({
  setConversationPreviewContext: async (_sessionId, _teamId, context) => {
    if (writeFails) throw new Error('mongo unavailable')
    written.push(context)
  },
  clearConversationPreviewLocalTools: async (sessionId) => {
    if (clearFails) throw new Error('still unavailable')
    cleared.push(sessionId)
  },
  // An ordinary question, not a plan's.
  findInputRequest: async () => undefined,
  resolveInputRequest: async (sessionId, userId, toolCallId) => {
    resolved.push([sessionId, userId, toolCallId])

    return true
  },
})

const { persistPreviewTurnContext } = await import('./chat-preview-prepare')

const turn = (localToolsEnabled: boolean, humanTurn = false, decisionReplyTo?: string) =>
  ({
    humanTurn,
    decisionReplyTo,
    sessionId: 'conv-1',
    teamId: 'team-1',
    userId: 'u1',
    origin: 'user',
    localToolsEnabled,
    messages: [],
    run: {},
  }) as unknown as PreviewChatTurnArgs

beforeEach(() => {
  written = []
  cleared = []
  resolved = []
  writeFails = false
  clearFails = false
})

test('a capable turn stores the Desktop-tool capability', async () => {
  await persistPreviewTurnContext(turn(true), 'req-1')

  expect(written).toEqual([{ activeTurnKey: 'req-1', activeTurnOrigin: 'user', localTools: true }])
  expect(cleared).toEqual([])
})

test('a failed context write revokes the capability instead of leaving a stale one', async () => {
  writeFails = true
  // An earlier Desktop turn's `localTools: true` must not survive into a turn
  // whose client runs no local tools.
  await persistPreviewTurnContext(turn(false), 'req-2')

  expect(cleared).toEqual(['conv-1'])
})

test('an incapable turn stops rather than inherit a capability it cannot revoke', async () => {
  writeFails = true
  clearFails = true
  // Both writes failed, so an earlier Desktop turn's `localTools: true` is
  // still readable. The turn must not run on it.
  await expect(persistPreviewTurnContext(turn(false), 'req-3')).rejects.toThrow('still unavailable')
})

test('a capable turn rides out a total write failure', async () => {
  writeFails = true
  clearFails = true
  // A stale `true` is what this turn would have written anyway, so there is
  // nothing to fail closed on.
  expect(await persistPreviewTurnContext(turn(true), 'req-4')).toBeUndefined()
  expect(cleared).toEqual([])
})

test('a human message from any client that names no question resolves nothing', async () => {
  // iOS, the CLI and older clients included: questions stay open until named by id.
  await persistPreviewTurnContext(turn(true, true), 'req-5')
  await persistPreviewTurnContext(turn(false, true), 'req-7')

  expect(resolved).toEqual([])
})

test('an agent-thread or resource turn leaves the decision waiting for the person', async () => {
  // Only a person can answer: a manager's relay or a webhook is not the reply.
  await persistPreviewTurnContext(turn(true, false), 'req-6')

  expect(resolved).toEqual([])
})

test('an explicit reply resolves the question it names when its turn is admitted', async () => {
  await persistPreviewTurnContext(turn(true, true, 'nuphos-q1'), 'req-9')

  // On the conversation owner's record, and only that question: others stay open.
  expect(resolved).toEqual([['conv-1', 'u1', 'nuphos-q1']])
})

test('a turn that is not a person speaking resolves nothing, even naming a question', async () => {
  await persistPreviewTurnContext(turn(true, false, 'nuphos-q1'), 'req-10')

  expect(resolved).toEqual([])
})
