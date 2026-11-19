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
let stored: AgentConversation | undefined

useRuntimeModels({ runtimeModelCatalog: () => Promise.resolve(catalog) })
useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(stored),
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
function conversation(moved = false) {
  stored = {
    sessionId: 'fixture',
    teamId: 'team',
    userId: 'owner',
    runtimeId: 'runtime',
    initialSessionConfig: { model: 'retired', effort: 'retired-effort' },
    ...(moved
      ? {
          runtimeMigration: {
            fromRuntimeId: 'old',
            toRuntimeId: 'runtime',
            movedAt: new Date(),
            movedBy: 'owner',
          },
        }
      : {}),
  } as AgentConversation

  return stored
}

test('catalog reads never erase unsupported saved settings before attachment', async () => {
  for (const moved of [false, true]) {
    const state = await conversationSessionConfig(conversation(moved), undefined, 'owner')

    // What the session will run on, named: the model and the effort it starts with.
    expect(state.options.map((option) => option.currentValue)).toEqual(['sol', 'low'])
  }
  expect(writes).toEqual([])
})
test('a model chosen on a moved conversation is saved together with its effort', async () => {
  const state = await conversationSessionConfig(
    conversation(true),
    { configId: 'model', value: 'astra' },
    'owner',
  )

  expect(state.options.map((option) => option.currentValue)).toEqual(['astra', 'low'])
  // The model is saved with the effort it runs on, never alone, and the record says what changed.
  expect(writes).toMatchObject([
    {
      $set: { initialSessionConfig: { model: 'astra', effort: 'low' } },
      $push: {
        settingsHistory: {
          actorId: 'owner',
          via: 'picker',
          model: { from: { value: 'retired' }, to: { value: 'astra' } },
          effort: { from: { value: 'retired-effort' }, to: { value: 'low' } },
        },
      },
    },
  ])
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
