import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'

import { conversationSessionConfig } from './session-config'
import { offeredSessionConfig } from './session-config-catalog'

import type { AgentConversation } from '@/lib/agent/db'

// #3807: an empty catalog's reason reached no one, so the picker said "send a message to start".
useRuntimeModels({
  runtimeModelCatalog: () => Promise.resolve({ models: [], reason: 'unreported' }),
})
useDb({
  db: () => ({
    collection: () => ({ updateOne: () => Promise.resolve({ matchedCount: 1 }) }),
  }),
})

test('a runtime with nothing to choose passes on why', async () => {
  const { options, reason } = await offeredSessionConfig(
    () => Promise.resolve({ models: [], reason: 'signed-out' }),
    {},
  )

  expect(options).toEqual([])
  expect(reason).toBe('signed-out')
})

test('a runtime with choices names no reason', async () => {
  const { reason } = await offeredSessionConfig(
    () => Promise.resolve({ models: [{ id: 'sol', name: 'Sol' }], reason: 'unreported' }),
    {},
  )

  expect(reason).toBeUndefined()
})

test('a conversation not started yet on such a runtime reads that reason', async () => {
  const conversation = {
    sessionId: 'fixture',
    teamId: 'team',
    userId: 'owner',
    runtimeId: 'runtime',
  } as AgentConversation

  expect(await conversationSessionConfig(conversation, undefined, 'owner')).toEqual({
    status: 'dormant',
    options: [],
    reason: 'unreported',
  })
})
