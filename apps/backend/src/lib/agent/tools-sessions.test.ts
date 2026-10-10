import { expect, test } from 'bun:test'

import { createSessionTools } from './tools-sessions'

import { byCodeUnit } from '@/lib/agent/sort-order'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

test('exposes the past-conversation tools in a team', () => {
  expect(Object.keys(createSessionTools('u', 'c', 'team')).sort(byCodeUnit)).toEqual([
    'list_recent_conversations',
    'read_conversation',
  ])
})

test('offers nothing outside a team scope', () => {
  expect(createSessionTools('u', 'c', null)).toEqual({})
})

const diagnostics = [{ message_index: 7, outcome: 'interrupted', reason: 'timeout' }]

useAgentDb({
  getConversationTranscriptForAgent: async (viewer, options) => {
    expect(viewer).toBe('u')
    expect(options).toMatchObject({ teamId: 'team', sessionId: 'other', fromIndex: 7, limit: 1 })

    return {
      conversation: {
        sessionId: 'other',
        title: 'Long turn',
        createdAt: new Date(0),
        messageCount: 9,
      },
      lines: ['#7 assistant: … [truncated]'],
      turnDiagnostics: diagnostics,
      nextIndex: 8,
    }
  },
})

test('read_conversation returns termination records outside the clipped transcript', async () => {
  const tool = createSessionTools('u', 'c', 'team').read_conversation!
  const result = await tool.execute!(
    { label: 'Read turn', session_id: 'other', from_index: 7, limit: 1 },
    { toolCallId: 'read', messages: [] },
  )

  expect(result).toMatchObject({ turn_diagnostics: diagnostics, next_index: 8 })
})
