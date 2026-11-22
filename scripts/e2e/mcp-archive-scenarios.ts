// nuphos_archive_session (#4008): an MCP client archives its Task as Archive in the app does,
// with the Task nested below it, and restores both; nobody else reaches the Task over MCP.
import { client, must } from './binding-access-scenarios.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { askOverMcp, mcp } from './mcp-scenarios.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'

type Listed = { sessions: { session_id: string }[] }

export const mcpArchiveScenarios: Scenario[] = [
  {
    name: 'an MCP client archives its Task with the Task below it and restores both; others cannot',
    run: async (_page, stack) => {
      const as = client(stack.apiUrl, stack.token)
      const { tool } = mcp(as)
      const task = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-archive')
      const below = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-archive-below')
      const nested = await as('PUT', `/agent/conversations/${below}/parent`, {
        parentSessionId: task,
        teamId: stack.teamId,
      })

      must(nested.status === 200, `the second Task to nest below the first, got ${nested.text}`)
      const listed = async () => {
        const ids = new Set<string>()

        for (const parent of [undefined, task]) {
          const reply = await tool<Listed>('nuphos_list_sessions', {
            team_id: stack.teamId,
            limit: 30,
            ...(parent ? { parent_session_id: parent } : {}),
          })

          for (const session of reply.structuredContent?.sessions ?? []) ids.add(session.session_id)
        }

        return [task, below].filter((id) => ids.has(id))
      }

      must((await listed()).length === 2, 'both Tasks listed before archiving')
      // Someone who has left the team, and a teammate who is not in the Task, are both refused.
      const outsider = await joinTeam(stack, 'mcp-archive-outsider')
      const left = await as('DELETE', `/teams/${stack.teamId}/members/${outsider.id}`)

      must(left.status < 300, `the outsider to be removed from the team, got ${left.text}`)
      const teammate = await joinTeam(stack, 'mcp-archive-teammate')

      for (const other of [outsider, teammate]) {
        const refused = await mcp(client(stack.apiUrl, other.token)).tool(
          'nuphos_archive_session',
          { session_id: task },
        )

        must(
          refused.isError === true && refused.content[0].text.includes('not found'),
          `${other.email} not to find the Task, got ${JSON.stringify(refused)}`,
        )
      }
      must((await listed()).length === 2, 'both Tasks still listed after the refusals')
      const archived = await tool<{ archived: boolean }>('nuphos_archive_session', {
        session_id: task,
      })

      must(
        archived.isError !== true && archived.structuredContent?.archived === true,
        `the Task to be archived, got ${JSON.stringify(archived)}`,
      )
      await until('both Tasks to leave the list', async () => (await listed()).length === 0)
      await tool('nuphos_archive_session', { session_id: task, archived: false })
      await until('both Tasks to come back', async () => (await listed()).length === 2)
    },
  },
]
