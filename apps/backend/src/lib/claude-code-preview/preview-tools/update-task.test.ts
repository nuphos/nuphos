import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'

import { threadToolModule } from './threads'

import type { PreviewToolContext } from '../preview-tool-context'
import type { AgentConversation } from '@/lib/agent/db'

// #3503: a Task or Bot changes its own model, effort or fast mode, never its agent or mode.
const SELF = '11111111-1111-4111-8111-111111111111'
const writes: unknown[] = []
let self: AgentConversation

const conversation = (bot: boolean) =>
  ({
    sessionId: SELF,
    userId: 'owner',
    teamId: 'team',
    title: bot ? 'Release Manager' : 'Fix the build',
    runtimeId: 'runtime',
    firstMessage: '',
    messageCount: 1,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    claudeCodePreview: {
      openabSessionId: 'acp-1',
      runtimeUrl: 'http://runtime',
      sessionConfig: [],
    },
    ...(bot ? { avatar: '05-rembrandt' } : {}),
  }) as AgentConversation

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useAgentDb({ getConversationBySessionId: async (id) => (id === SELF ? self : null) })
useRuntimeModels({
  runtimeModelCatalog: () =>
    Promise.resolve({
      models: [
        { id: 'sol', name: 'Sol' },
        { id: 'luna', name: 'Luna' },
      ],
      controls: { modelId: 'sol', effort: [], defaultEffort: undefined, fast: [] },
    }),
})
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

const tools = () =>
  threadToolModule().handlers({
    userId: 'owner',
    teamId: 'team',
    sessionId: SELF,
    locale: 'en',
  } as PreviewToolContext)

test.each([false, true])(
  'a conversation picks its own model for its next turn (Bot=%s)',
  async (bot) => {
    self = conversation(bot)
    const result = await tools().update_task?.({
      label: 'Lighter model',
      taskId: SELF,
      model: 'luna',
    })

    expect(result).not.toMatchObject({ isError: true })
    expect(JSON.stringify(result)).toContain('next_turn')
    expect(writes).toEqual([{ $set: { 'claudeCodePreview.pendingSessionConfig.model': 'luna' } }])
  },
)

test.each([{ runtimeId: 'runtime-2' }, { fullAccess: false }])(
  'a conversation cannot change its own agent or mode: %o',
  async (change) => {
    self = conversation(false)
    const result = await tools().update_task?.({ label: 'x', taskId: SELF, ...change })

    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result)).toContain('cannot change its own permission mode or agent')
    expect(writes).toEqual([])
  },
)

test('update_thread still works for one release, taking threadId', async () => {
  self = conversation(false)
  const result = await tools().update_thread?.({ label: 'x', threadId: SELF, model: 'luna' })

  expect(result).not.toMatchObject({ isError: true })
  expect(writes).toHaveLength(1)
})
