import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { TOOL_DEFINITIONS } from '@/lib/mcp/protocol'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

let member = true
let queried = false

useIdentity({ getTeamMembership: async () => (member ? ({ role: 'MEMBER' } as never) : null) })
useAgentDb({
  agentConversations: () =>
    ({
      find: () => {
        queried = true

        return {
          sort: () => ({
            limit: () => ({
              toArray: async () => [
                {
                  _id: new ObjectId(),
                  sessionId: 'task',
                  title: 'Bound task',
                  runtimeLabel: 'Agent',
                },
              ],
            }),
          }),
        }
      },
    }) as never,
})
const lookup = async (args: Record<string, unknown>) => {
  const { toolsForContext } = await import('./tools')
  const handler = toolsForContext({ userId: 'u1' } as never).nuphos_find_pr_sessions

  expect(handler).toBeDefined()

  return handler(args)
}

beforeEach(() => {
  member = true
  queried = false
})
test('advertises a read-only bound-session lookup, without authorship claims', () => {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === 'nuphos_find_pr_sessions')

  expect(definition?.description).toContain('bound to')
})
test('returns bound sessions using the existing session-resource store', async () => {
  const result = await lookup({ team_id: 't1', repository: 'owner/repo', number: 42 })

  expect(result.isError).not.toBe(true)
  expect(result.structuredContent).toMatchObject({
    sessions: [{ session_id: 'task', title: 'Bound task', agent: 'Agent' }],
  })
})
test('refuses nonmembers before querying bindings', async () => {
  member = false
  expect((await lookup({ team_id: 't1', repository: 'owner/repo', number: 42 })).isError).toBe(true)
  expect(queried).toBe(false)
})
test.each([
  { repository: 'owner/repo/extra', number: 42 },
  { repository: 'owner/repo', number: -1 },
  { repository: 'owner/repo', number: 1.5 },
  { repository: 'owner/repo', number: '42' },
  { repository: 'owner/repo', number: 42, cursor: 'invalid' },
])('rejects invalid lookup arguments before querying', async (args) => {
  expect((await lookup({ team_id: 't1', ...args })).isError).toBe(true)
  expect(queried).toBe(false)
})
