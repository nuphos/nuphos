import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'

import { ownSessionConfigUpdate, queueOwnSessionConfig } from './own-session-config'
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

test('a Bot validates an unstarted model and effort without a separate write', async () => {
  const update = await ownSessionConfigUpdate(
    conversation(),
    { model: 'astra', effort: 'high' },
    'owner',
  )

  expect(update).toEqual({ initialSessionConfig: { model: 'astra', effort: 'high' } })
  expect(writes).toEqual([])
})

// #3503: a Task or Bot picks its own model through update_task, for its next turn.
const running = () =>
  ({
    ...conversation(),
    claudeCodePreview: {
      openabSessionId: 'acp-1',
      runtimeUrl: 'http://runtime',
      sessionConfig: [],
    },
  }) as AgentConversation

test('a running Task queues its own pick for the next turn, leaving this reply on its settings', async () => {
  const model = await queueOwnSessionConfig(running(), { model: 'astra', effort: 'high' }, 'owner')

  expect(writes).toEqual([
    {
      $set: {
        'claudeCodePreview.pendingSessionConfig.model': 'astra',
        'claudeCodePreview.pendingSessionConfig.effort': 'high',
      },
    },
  ])
  expect(model).toMatchObject({ model: 'astra', effort: 'high' })
})

test('an unstarted Task starts on its own pick', async () => {
  await queueOwnSessionConfig(conversation(), { model: 'astra' }, 'owner')

  expect(writes).toEqual([{ $set: { initialSessionConfig: { model: 'astra' } } }])
})

test("a model its agent does not offer is refused with the choices, and nothing is saved", async () => {
  await expect(queueOwnSessionConfig(running(), { model: 'retired' }, 'owner')).rejects.toThrow(
    'Choose one of: sol, astra',
  )
  expect(writes).toEqual([])
})
