// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import type { PreviewChatTurnArgs } from './chat-preview-turn'

let written: Record<string, unknown>[] = []
let cleared: string[] = []
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
})

const { persistPreviewTurnContext } = await import('./chat-preview-prepare')

const turn = (localToolsEnabled: boolean) =>
  ({
    sessionId: 'conv-1',
    teamId: 'team-1',
    userId: 'u1',
    origin: 'user',
    localToolsEnabled,
    run: {},
  }) as unknown as PreviewChatTurnArgs

beforeEach(() => {
  written = []
  cleared = []
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
