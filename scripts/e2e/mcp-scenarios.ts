// The MCP server an outside coding agent (Claude Code, Codex) talks to, called over HTTP
// with the person's session token as such a client sends it, and read back in the app.
import { client, must } from './binding-access-scenarios.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'

type Client = ReturnType<typeof client>

type ToolReply<T> = {
  content: { type: string; text: string }[]
  structuredContent?: T
  isError?: boolean
}

function mcp(as: Client) {
  const rpc = async <T>(method: string, params?: unknown): Promise<T> => {
    const reply = await as('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params })
    const body = reply.body as { result: T; error?: unknown } | null

    must(
      reply.status === 200 && body !== null && !body.error,
      `MCP ${method} to answer, got ${reply.text}`,
    )

    return body.result
  }
  const tool = <T>(name: string, args: Record<string, unknown> = {}) =>
    rpc<ToolReply<T>>('tools/call', { name, arguments: args })

  return { rpc, tool }
}

type Tool = ReturnType<typeof mcp>['tool']

const prompt = (marker: string) => `From MCP ${marker}`

/** Starts a Task with `nuphos_ask` and polls `nuphos_check` until the agent acknowledges `marker`. */
async function askOverMcp(tool: Tool, teamId: string, marker: string): Promise<string> {
  const asked = await tool<{ session_id: string }>('nuphos_ask', {
    prompt: prompt(marker),
    team_id: teamId,
    wait: false,
  })
  const sessionId = asked.structuredContent?.session_id

  must(
    typeof sessionId === 'string',
    `nuphos_ask to return a session, got ${asked.content[0].text}`,
  )
  await until(`nuphos_check to return the reply to ${marker}`, async () => {
    const checked = await tool<{ status: string; answer?: string }>('nuphos_check', {
      session_id: sessionId,
    })
    const result = checked.structuredContent

    must(
      result?.status === 'completed' && result.answer?.includes(`ACK ${marker}`) === true,
      `a completed reply with ACK ${marker}, got ${JSON.stringify(result)}`,
    )

    return true
  })

  return sessionId
}

/** Reads SSE frames in wire order, preserving partial frames between chunks. */
function notifications(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''

  return async () => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n')

      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary)

        buffer = buffer.slice(boundary + 2)
        const data = /^data: (.+)$/m.exec(frame)?.[1]
        const id = /^id: (.+)$/m.exec(frame)?.[1]

        if (data && id)
          return { id, body: JSON.parse(data) as { params: { status: string; answer?: string } } }
        continue
      }
      const next = await reader.read()

      must(!next.done, 'the subscription to stay open until the notification')
      buffer += decoder.decode(next.value, { stream: true })
    }
  }
}

export const mcpScenarios: Scenario[] = [
  {
    name: 'an MCP client receives completion over SSE and reconnects without replaying unchanged state',
    run: async (_page, stack) => {
      const { tool } = mcp(client(stack.apiUrl, stack.token))
      const sessionId = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-notify-first')
      const url = `${stack.apiUrl}/mcp?session_id=${sessionId}`
      const open = async (last?: string) => {
        const response = await fetch(url, {
          headers: {
            authorization: `Bearer ${stack.token}`,
            ...(last ? { 'Last-Event-ID': last } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        })

        must(response.ok && response.body !== null, 'the authenticated SSE subscription')

        return response.body.getReader()
      }
      const reader = await open()
      const next = notifications(reader)
      let completed = await next()

      must(completed.body.params.status === 'completed', 'a stored result on initial subscription')
      try {
        await tool('nuphos_ask', {
          team_id: stack.teamId,
          session_id: sessionId,
          wait: false,
          prompt: prompt('E2E_DELIVERY:mcp-notify-second'),
        })
        do {
          completed = await next()
        } while (!completed.body.params.answer?.includes('ACK E2E_DELIVERY:mcp-notify-second'))
        must(
          completed.body.params.status === 'completed',
          'a completion push without nuphos_check polling',
        )
      } finally {
        await reader.cancel()
      }
      const resumed = await open(completed.id)
      const changed = notifications(resumed)

      try {
        await tool('nuphos_ask', {
          team_id: stack.teamId,
          session_id: sessionId,
          wait: false,
          prompt: prompt('E2E_DELIVERY:mcp-notify-third'),
        })
        let event = await changed()

        must(event.id !== completed.id, 'Last-Event-ID to suppress unchanged state')
        while (!event.body.params.answer?.includes('ACK E2E_DELIVERY:mcp-notify-third'))
          event = await changed()
        must(event.body.params.status === 'completed', 'the next completed turn after reconnect')
      } finally {
        await resumed.cancel()
      }
    },
  },
  {
    name: 'an MCP client lists the tools and teams, asks the agent, and the Task shows in the app',
    run: async (page, stack) => {
      const { rpc, tool } = mcp(client(stack.apiUrl, stack.token))
      const init = await rpc<{ serverInfo: { name: string } }>('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0' },
      })

      must(
        init.serverInfo.name === 'nuphos-agent',
        `the Nuphos server, got ${init.serverInfo.name}`,
      )
      const { tools } = await rpc<{ tools: { name: string }[] }>('tools/list')
      const names = tools.map((listed) => listed.name)

      for (const name of [
        'nuphos_ask',
        'nuphos_check',
        'nuphos_list_teams',
        'nuphos_update_session',
      ])
        must(names.includes(name), `${name} in tools/list, got ${names.join(', ')}`)
      const listed = await tool<{ teams: { team_id: string }[] }>('nuphos_list_teams')
      const teams = listed.structuredContent?.teams ?? []

      must(
        teams.some((team) => team.team_id === stack.teamId),
        `the E2E team in nuphos_list_teams, got ${JSON.stringify(teams)}`,
      )
      await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp')
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await page.getByText(prompt('E2E_DELIVERY:mcp'), { exact: true }).first().click()
      await page.getByText('ACK E2E_DELIVERY:mcp', { exact: true }).waitFor()
    },
  },
  {
    // #2884: the model changed, then the refusal escaped as a bare "Internal error".
    name: "Full Access on a Task under a Bot is refused over MCP, and the Task's model stays",
    run: async (_page, stack) => {
      const as = client(stack.apiUrl, stack.token)
      const { tool } = mcp(as)
      const task = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-task')
      const created = await as('POST', '/agent/bots', { teamId: stack.teamId, title: 'MCP Bot' })
      const bot = created.body as { sessionId?: unknown } | null

      must(
        created.status === 201 && typeof bot?.sessionId === 'string',
        `the Bot to be created, got ${created.text}`,
      )
      const nested = await as('PUT', `/agent/conversations/${task}/parent`, {
        parentSessionId: bot.sessionId,
        teamId: stack.teamId,
      })

      must(nested.status === 200, `the Task to move under the Bot, got ${nested.text}`)
      const model = async () => {
        const config = await as(
          'GET',
          `/agent/conversations/${task}/model-config?teamId=${stack.teamId}`,
        )
        const { options } = config.body as { options: { kind: string; currentValue: string }[] }

        return options.find((option) => option.kind === 'model')?.currentValue
      }

      must((await model()) === 'fixture', "the Task on the fixture agent's default model")
      for (const fullAccess of [false, true]) {
        const refused = await tool('nuphos_update_session', {
          session_id: task,
          model: 'fixture-small',
          full_access: fullAccess,
        })

        must(
          refused.isError === true && refused.content[0].text.includes(bot.sessionId),
          `full_access ${String(fullAccess)} refused naming the Bot, got ${JSON.stringify(refused)}`,
        )
        must(
          (await model()) === 'fixture',
          `the refused full_access ${String(fullAccess)} to leave the model as it was`,
        )
      }
      // Model alone still changes, and the Task reports whose Full Access it follows.
      const changed = await tool<{ full_access: boolean; full_access_follows?: string }>(
        'nuphos_update_session',
        { session_id: task, model: 'fixture-small' },
      )

      must(
        changed.structuredContent?.full_access === true &&
          changed.structuredContent.full_access_follows === bot.sessionId,
        `the Bot's Full Access, got ${JSON.stringify(changed.structuredContent)}`,
      )
      must((await model()) === 'fixture-small', 'the model to change without full_access')
    },
  },
]
