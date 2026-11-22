import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { forgetConversationPreviewSession } from './conversations-runtime'

let memory = portabilityDb()

useDb({ db: () => memory })
beforeEach(() => {
  memory = portabilityDb()
  memory.rows('agent_conversations').push({
    sessionId: 'c',
    teamId: 't',
    initialSessionConfig: { model: 'sonnet' },
    claudeCodePreview: {
      openabSessionId: 's',
      runtimeUrl: 'wss://runtime/acp',
      runtimeDefaults: { model: 'opus' },
    },
  })
})
const stored = () => memory.rows('agent_conversations')[0]!

test('forgetting a session keeps the model pick it ran with, which is no change', async () => {
  await forgetConversationPreviewSession('c', 't', 's', { model: 'opus' })

  expect(stored().claudeCodePreview).toBeUndefined()
  expect(stored().initialSessionConfig).toEqual({ model: 'opus' })
  expect(stored().settingsHistory).toBeUndefined()
})

// No pick to carry over must not erase the conversation's stored one, which the next session runs.
test('forgetting with an empty pick leaves the stored pick, and records the change back to it', async () => {
  await forgetConversationPreviewSession('c', 't', 's', {})

  expect(stored().claudeCodePreview).toBeUndefined()
  expect(stored().initialSessionConfig).toEqual({ model: 'sonnet' })
  expect(stored().settingsHistory).toMatchObject([
    {
      actorId: 'system',
      via: 'session_lost',
      model: { from: { value: 'opus' }, to: { value: 'sonnet' } },
    },
  ])
})

test('another session’s attachment is left alone', async () => {
  await forgetConversationPreviewSession('c', 't', 'other', { model: 'opus' })

  expect(stored().claudeCodePreview?.openabSessionId).toBe('s')
  expect(stored().settingsHistory).toBeUndefined()
})
