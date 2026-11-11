import { expect, test } from 'bun:test'

import { agentRuns } from '@/lib/agent/run-admission'
import { byCodeUnit } from '@/lib/agent/sort-order'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'

import { createSessionTools } from './tools-sessions'

import type * as dbActual from './db'
import type { AgentRun } from '@/routes/agent/types'

test('exposes the past-conversation tools in a team', () => {
  expect(Object.keys(createSessionTools('u', 'c', 'team')).sort(byCodeUnit)).toEqual([
    'create_bot',
    'list_recent_conversations',
    'list_tasks',
    'read_conversation',
    'rename_conversation',
    'report_task',
    'update_self',
  ])
})

test('offers nothing outside a team scope', () => {
  expect(createSessionTools('u', 'c', null)).toEqual({})
})

let runningLastAssistantAt: Date | null = null
const diagnostics = [{ message_index: 7, outcome: 'interrupted', reason: 'timeout' }]

let listOptions: unknown
const selfUpdates: unknown[] = []
const shells: Record<string, unknown>[] = []
// Full-access grants a new Bot starts with: `${userId}:${conversationId}` → bypass.
const bypass = new Map<string, unknown>()
// The calling conversation's own permission mode.
let callerBypass = true
let instructionsSaved = true

useDb({
  db: () => ({
    collection: () => ({
      findOne: (filter: { conversationId: string; userId: string }) =>
        Promise.resolve(
          filter.conversationId === 'c' && filter.userId === 'u' ? { bypass: callerBypass } : null,
        ),
      updateOne: (
        filter: { conversationId: string; userId: string },
        update: { $setOnInsert?: { bypass?: unknown } },
      ) => {
        bypass.set(`${filter.userId}:${filter.conversationId}`, update.$setOnInsert?.bypass)

        return Promise.resolve()
      },
    }),
  }),
})

useAgentDb({
  getConversations: async (viewer, options) => {
    expect(viewer).toBe('u')
    listOptions = options

    return {
      conversations: [
        {
          sessionId: 'child',
          userId: 'u',
          parentSessionId: 'c',
          title: 'Sub-agent',
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          messageCount: 2,
        } as Awaited<ReturnType<typeof dbActual.getConversations>>['conversations'][number],
      ],
      nextCursor: null,
      hasMore: false,
    }
  },
  updateBotSelf: async (sessionId, userId, teamId, update) => {
    selfUpdates.push(update)

    return (
      (sessionId === 'c' ||
        (instructionsSaved && shells.some((shell) => shell.sessionId === sessionId))) &&
      userId === 'u' &&
      teamId === 'team'
    )
  },
  upsertConversationShell: async (data) => {
    shells.push(data)

    return { isNew: true }
  },
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
        lastAssistantAt: runningLastAssistantAt,
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
      lastAssistantAt: null,
    }
  },
})

test("list_recent_conversations children:true lists this conversation's own sub-agents", async () => {
  const tool = createSessionTools('u', 'c', 'team').list_recent_conversations!
  const result = await tool.execute!(
    { label: 'List sub-agents', children: true, scope: 'team' },
    { toolCallId: 'list', messages: [] },
  )

  // Owner-scoped even when team scope is asked for: never another user's threads.
  expect(listOptions).toMatchObject({ teamId: 'team', scope: 'mine', parentSessionId: 'c' })
  expect(result).toMatchObject({
    conversations: [{ session_id: 'child', parent_session_id: 'c' }],
  })
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

    // Stored, but the run has not said so yet.
    runningLastAssistantAt = new Date('2026-10-13T08:20:01Z')
    const persisted = (await tool.execute!(
      { label: 'Read', session_id: 'running' },
      { toolCallId: 'read', messages: [] },
    )) as { transcript: string }

    expect(persisted).not.toHaveProperty('in_progress')
    runningLastAssistantAt = null

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

test('update_self changes only the fields it is given, on the current conversation', async () => {
  const tool = createSessionTools('u', 'c', 'team').update_self!
  const result = await tool.execute!(
    { label: 'Name myself', name: 'Release Helper', avatar: '07-ada' },
    { toolCallId: 'self', messages: [] },
  )

  expect(result).toEqual({ updated: ['title', 'avatar'] })
  expect(selfUpdates.at(-1)).toEqual({ title: 'Release Helper', avatar: '07-ada' })
})

test('update_self refuses an empty change and a conversation that is not a Bot', async () => {
  const empty = await createSessionTools('u', 'c', 'team').update_self!.execute!(
    { label: 'Nothing' },
    { toolCallId: 'self', messages: [] },
  )
  const task = await createSessionTools('u', 'a-task', 'team').update_self!.execute!(
    { label: 'Instructions', instructions: 'Be brief.' },
    { toolCallId: 'self', messages: [] },
  )

  expect(empty).toHaveProperty('error')
  expect(task).toHaveProperty('error')
})

test('create_bot makes a Bot owned by the person the agent works for, as "+ New Bot" does', async () => {
  const result = (await createSessionTools('u', 'c', 'team').create_bot!.execute!(
    { label: 'New Bot', name: 'Release Helper', avatar: '07-ada', instructions: 'Watch releases.' },
    { toolCallId: 'bot', messages: [] },
  )) as { session_id: string; [field: string]: unknown }
  const shell = shells.at(-1)

  // The person's own 1:1 Bot, on their default agent, never nested under the caller.
  expect(shell).toEqual({
    sessionId: result.session_id,
    userId: 'u',
    teamId: 'team',
    title: 'Release Helper',
    firstMessage: '',
    avatar: '07-ada',
  })
  expect(result).toEqual({
    session_id: result.session_id,
    name: 'Release Helper',
    avatar: '07-ada',
    full_access: true,
    _links: { web: `/teams/team/agent/${result.session_id}` },
  })
  // A caller in full access makes a Bot in full access.
  expect(bypass.get(`u:${result.session_id}`)).toBe(true)
  expect(selfUpdates.at(-1)).toEqual({ instructions: 'Watch releases.' })
})

test('create_bot picks a face when none is given and writes no empty instructions', async () => {
  const updates = selfUpdates.length
  const result = (await createSessionTools('u', 'c', 'team').create_bot!.execute!(
    { label: 'New Bot', name: 'Helper' },
    { toolCallId: 'bot', messages: [] },
  )) as { avatar: string }

  expect(result.avatar).toMatch(/^\d{2}-[a-z-]+$/)
  expect(selfUpdates).toHaveLength(updates)
})

test('create_bot gives a caller that needs approvals a Bot that needs them too', async () => {
  callerBypass = false
  try {
    const result = (await createSessionTools('u', 'c', 'team').create_bot!.execute!(
      { label: 'New Bot', name: 'Helper' },
      { toolCallId: 'bot', messages: [] },
    )) as { session_id: string; full_access: boolean }

    expect(result.full_access).toBe(false)
    expect(bypass.get(`u:${result.session_id}`)).toBe(false)
  } finally {
    callerBypass = true
  }
})

test('create_bot says so when the instructions were not saved', async () => {
  instructionsSaved = false
  try {
    const result = await createSessionTools('u', 'c', 'team').create_bot!.execute!(
      { label: 'New Bot', name: 'Helper', instructions: 'Watch releases.' },
      { toolCallId: 'bot', messages: [] },
    )

    expect(result).toHaveProperty('session_id')
    expect(result).toHaveProperty('error')
  } finally {
    instructionsSaved = true
  }
})
