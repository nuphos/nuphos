import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'

import { conversationSessionConfig } from './session-config'

import type { AgentConversation } from '@/lib/agent/db'

const catalog = {
  models: [
    { id: 'sol', name: 'Sol' },
    { id: 'astra', name: 'Astra' },
  ],
  controls: {
    modelId: 'sol',
    effort: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
    defaultEffort: 'low',
    fast: [],
  },
}
const writes: unknown[] = []

useRuntimeModels({ runtimeModelCatalog: () => Promise.resolve(catalog) })
useDb({
  db: () => ({
    collection: () => ({
      updateOne: (_query: unknown, update: unknown) => {
        writes.push(update)

        return Promise.resolve({ matchedCount: 1 })
      },
    }),
  }),
})
beforeEach(() => {
  writes.length = 0
})
const conversation = (moved = false) =>
  ({
    sessionId: 'fixture',
    teamId: 'team',
    userId: 'owner',
    runtimeId: 'runtime',
    initialSessionConfig: { model: 'retired', effort: 'retired-effort' },
    ...(moved
      ? {
          runtimeMigration: {
            mode: 'history',
            fromRuntimeId: 'old',
            toRuntimeId: 'runtime',
            movedAt: new Date(),
            movedBy: 'owner',
          },
        }
      : {}),
  }) as AgentConversation

test('catalog reads never erase unsupported saved settings before attachment', async () => {
  for (const moved of [false, true]) {
    const state = await conversationSessionConfig(conversation(moved), undefined, 'owner')

    expect(state.options[0]?.currentValue).toBe(moved ? '' : 'sol')
  }
  expect(writes).toEqual([])
})
test('an explicit valid choice on a moved conversation is persisted', async () => {
  const state = await conversationSessionConfig(
    conversation(true),
    { configId: 'model', value: 'astra' },
    'owner',
  )

  expect(state.options[0]?.currentValue).toBe('astra')
  expect(writes).toEqual([{ $set: { initialSessionConfig: { model: 'astra' } } }])
})
test('an unsupported explicit choice is refused without deleting the saved settings', async () => {
  await expect(
    conversationSessionConfig(
      conversation(true),
      { configId: 'model', value: 'not-offered' },
      'owner',
    ),
  ).rejects.toMatchObject({ code: 'invalid_runtime_config' })
  expect(writes).toEqual([])
})
