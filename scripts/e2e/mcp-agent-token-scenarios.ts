import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp } from './mcp-scenarios.ts'

import type { Scenario } from './ui.ts'

export const mcpAgentTokenScenarios: Scenario[] = [
  {
    // #3516: an unattended agent signs in as a Bot, not with a person's OAuth grant.
    name: "a Bot's agent token drives /mcp within its team, and its prompt is the Bot's",
    run: async (_page, stack) => {
      const as = client(stack.apiUrl, stack.token)
      const minted = await as('POST', '/auth/cli-tokens', {
        teamId: stack.teamId,
        name: 'E2E MCP Bot',
      })
      const { token, cliToken } = minted.body as { token: string; cliToken: { id: string } }

      must(minted.status === 201, `an agent token, got ${minted.text}`)
      const { tool } = mcp(client(stack.apiUrl, token))
      const listed = await tool<{ teams: { team_id: string }[] }>('nuphos_list_teams')
      const teams = (listed.structuredContent?.teams ?? []).map((team) => team.team_id)

      must(
        teams.length === 1 && teams[0] === stack.teamId,
        `its own team only, got ${teams.join(', ')}`,
      )
      const sessionId = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-bot')
      const read = await as('GET', `/agent/conversations/${sessionId}?teamId=${stack.teamId}`)
      const { messages } = read.body as {
        messages: { role: string; metadata?: { sender?: { type: string; id: string } } }[]
      }
      const sender = messages.find((message) => message.role === 'user')?.metadata?.sender

      must(
        sender?.type === 'agent' && sender.id === cliToken.id,
        `the prompt to be the Bot's, got ${JSON.stringify(sender)}`,
      )
    },
  },
]
