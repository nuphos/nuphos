import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summaryTriggerHome } from './chatSummaryTriggerHome.ts'

import type { AgentConversation } from '../../../api/agent-types.ts'

const chat = (extra: Partial<AgentConversation>) =>
  ({ sessionId: 'chat', title: 'Chat', ...extra }) as AgentConversation

test('Task triggers stay attached to the open Task', () => {
  assert.equal(summaryTriggerHome('task'), 'task')
  assert.equal(
    summaryTriggerHome('task', chat({ faces: [{ id: 'other', name: 'Other', agent: {} }] })),
    'task',
  )
})

test('a Bot 1:1 chat lists triggers attached to the Bot, not the chat channel', () => {
  assert.equal(
    summaryTriggerHome(
      'chat',
      chat({ kind: 'channel', faces: [{ id: 'bot', name: 'Bot', agent: {} }] }),
    ),
    'bot',
  )
})

test('a group or person-only chat never chooses an arbitrary agent as its trigger home', () => {
  assert.equal(
    summaryTriggerHome(
      'chat',
      chat({ kind: 'channel', faces: [{ id: 'person', name: 'Person' }] }),
    ),
    'chat',
  )
  assert.equal(
    summaryTriggerHome(
      'chat',
      chat({
        kind: 'channel',
        faces: [
          { id: 'a', name: 'A', agent: {} },
          { id: 'b', name: 'B', agent: {} },
        ],
      }),
    ),
    'chat',
  )
})
