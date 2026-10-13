import { expect, test } from 'bun:test'

import { agentRuns } from '@/lib/agent/run-admission'
import { byCodeUnit } from '@/lib/agent/sort-order'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { createSessionTools } from './tools-sessions'

import type { AgentRun } from '@/routes/agent/types'

test('exposes the past-conversation tools in a team', () => {
  expect(Object.keys(createSessionTools('u', 'c', 'team')).sort(byCodeUnit)).toEqual([
    'list_recent_conversations',
    'read_conversation',
    'rename_conversation',
  ])
})

test('offers nothing outside a team scope', () => {
  expect(createSessionTools('u', 'c', null)).toEqual({})
})

const diagnostics = [{ message_index: 7, outcome: 'interrupted', reason: 'timeout' }]

useAgentDb({
  renameConversation: async (sessionId, userId, teamId, title) =>
    sessionId === 'c' && userId === 'u' && teamId === 'team' && title === 'Incident review',
  getConversationTranscriptForAgent: async (viewer, options) => {
    expect(viewer).toBe('u')
    if (options.sessionId === 'running') {
      return {
        conversation: {
          sessionId: 'running',
          userId: 'owner',
          title: 'Running turn',
          createdAt: new Date(0),
          messageCount: 32,
        },
        lines: ['#31 user: deploy it'],
        turnDiagnostics: [],
        nextIndex: null,
      }
    }
    expect(options).toMatchObject({ teamId: 'team', sessionId: 'other', fromIndex: 7, limit: 1 })

    return {
      conversation: {
        sessionId: 'other',
        userId: 'owner',
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

function frame(event: Record<string, unknown>) {
  return `data: ${JSON.stringify(event)}\n\n`
}

test('read_conversation ends with the turn still running', async () => {
  const run = {
    key: 'owner:s1',
    streamId: 's1',
    sessionId: 'running',
    userId: 'owner',
    done: false,
    createdAt: Date.parse('2026-10-13T08:00:00Z'),
    lastFrameAt: Date.parse('2026-10-13T08:20:00Z'),
    frames: [
      frame({ type: 'text-delta', delta: 'Checking the cluster.' }),
      frame({ type: 'tool-input-available', toolCallId: 't1', toolName: 'Bash', input: {} }),
    ],
  } as unknown as AgentRun

  agentRuns.set(run.key, run)
  try {
    const tool = createSessionTools('u', 'c', 'team').read_conversation!
    const result = (await tool.execute!(
      { label: 'Read', session_id: 'running' },
      { toolCallId: 'read', messages: [] },
    )) as { transcript: string; in_progress: unknown }

    expect(result.in_progress).toEqual({
      index: 32,
      started_at: '2026-10-13T08:00:00.000Z',
      last_update_at: '2026-10-13T08:20:00.000Z',
    })
    expect(result.transcript).toBe(
      '#31 user: deploy it\n#32 assistant (in progress, started 2026-10-13T08:00:00.000Z, last update 2026-10-13T08:20:00.000Z): Checking the cluster.\n[tool: Bash]',
    )

    run.frames.push(frame({ type: 'atlas-transcript-tail', messages: [] }))
    const settled = (await tool.execute!(
      { label: 'Read', session_id: 'running' },
      { toolCallId: 'read', messages: [] },
    )) as { transcript: string }

    expect(settled).not.toHaveProperty('in_progress')
    expect(settled.transcript).toBe('#31 user: deploy it')
  } finally {
    agentRuns.delete(run.key)
  }
})

test('rename_conversation renames the current conversation by default', async () => {
  const tool = createSessionTools('u', 'c', 'team').rename_conversation!
  const result = await tool.execute!(
    { label: 'Rename', title: 'Incident review' },
    { toolCallId: 'rename', messages: [] },
  )

  expect(result).toEqual({ session_id: 'c', title: 'Incident review' })
})

test('rename_conversation reports a conversation it cannot rename', async () => {
  const tool = createSessionTools('u', 'c', 'team').rename_conversation!
  const result = await tool.execute!(
    { label: 'Rename', title: 'Incident review', session_id: 'teammate-chat' },
    { toolCallId: 'rename', messages: [] },
  )

  expect(result).toHaveProperty('error')
})
