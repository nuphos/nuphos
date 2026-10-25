import { beforeEach, expect, test } from 'bun:test'

import { rememberRuntimeState } from '@/lib/claude-code-preview/runtime-state-store'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

import { serializeConversationList } from './conversations-list-view'

// The list reports each row's runtime status from the stored push and the run
// store only; it never opens a runtime connection.
const runs = new Map<string, { streamId: string; startedAt: string }>()
const runLookups: string[] = []

useRedis({ redisEnabled: () => false, withRedis: async () => null })
useIdentity({ getTeamMembers: async () => [] })
useSlackAgentBot({ getSlackAgentThreadsBySessionIds: async () => [] })
useDb({
  db: () =>
    ({
      collection: () => ({ find: () => ({ toArray: async () => [] }) }),
    }) as never,
})
useAgentRunStore({
  getActiveAgentRunForSession: async (_userId: string, sessionId: string) => {
    runLookups.push(sessionId)

    return (runs.get(sessionId) ?? null) as never
  },
})

beforeEach(() => {
  runs.clear()
  runLookups.length = 0
})

const conversation = (sessionId: string) => ({
  sessionId,
  userId: 'user-a',
  teamId: 'team-a',
  claudeCodePreview: { openabSessionId: `openab-${sessionId}`, runtimeUrl: 'ws://runtime' },
})

const stored = (sessionId: string, state: string) =>
  rememberRuntimeState('team-a', `openab-${sessionId}`, {
    state,
    schemaVersion: 2,
    actions: { send: state !== 'active', cancel: state === 'active', steer: false },
    epoch: 'runtime-1',
    revision: 1,
  } as never)

async function list(...sessionIds: string[]) {
  return (await serializeConversationList(
    sessionIds.map(conversation),
    { userId: 'user-a' } as never,
    'team-a',
  )) as { runtimeState: { state: string }; activeRun: unknown }[]
}

test('a running turn whose snapshot is gone is still listed as active, with its run', async () => {
  runs.set('turn', { streamId: 'stream-1', startedAt: '2026-10-14T18:00:00.000Z' })
  const [row] = await list('turn')

  expect(row?.runtimeState.state).toBe('active')
  expect(row?.activeRun).toEqual({ streamId: 'stream-1', startedAt: '2026-10-14T18:00:00.000Z' })
})

test('no snapshot and no run reads as ready for the next message, never an error', async () => {
  const [row] = await list('quiet')

  expect(row?.runtimeState).toMatchObject({ state: 'dormant', actions: { send: true } })
  expect(row?.activeRun).toBeNull()
})

test('a stored idle snapshot is listed as-is without asking the run store', async () => {
  stored('idle', 'idle')
  stored('busy', 'active')
  runs.set('busy', { streamId: 'stream-2', startedAt: '2026-10-14T18:00:00.000Z' })
  const [idle, busy] = await list('idle', 'busy')

  expect(idle?.runtimeState.state).toBe('idle')
  expect(busy?.runtimeState.state).toBe('active')
  expect(busy?.activeRun).toMatchObject({ streamId: 'stream-2' })
  expect(runLookups).toEqual(['busy'])
})

test('a row leaves out what only the open conversation or the server reads', async () => {
  const [row] = (await serializeConversationList(
    [
      {
        ...conversation('slim'),
        title: 'Slim',
        credentialAccess: { awsRoleIds: ['role-a'] },
        claudeCodePreviewContext: { cwd: '/w' },
        initialSessionConfig: { model: 'm' },
        compactionSummary: 'summary',
        tokenUsage: {
          inputTokens: 1_000_000,
          providers: [
            { provider: 'vertex.anthropic', modelId: 'claude-opus-5', inputTokens: 1_000_000 },
          ],
        },
      },
    ],
    { userId: 'user-a' } as never,
    'team-a',
  )) as Record<string, unknown>[]

  expect(row?.title).toBe('Slim')
  expect(row?.tokenUsage).toEqual({ costUsd: 5 })
  for (const field of [
    'credentialAccess',
    'claudeCodePreview',
    'claudeCodePreviewContext',
    'initialSessionConfig',
    'compactionSummary',
  ]) {
    expect(row).not.toHaveProperty(field)
  }
})
