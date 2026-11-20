// #4062: a Task started with nuphos_ask and nothing else starts as a new Task in the app does,
// on the agent and model settings of the person's last Task and with Full Access.
import { randomUUID } from 'node:crypto'

import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp } from './mcp-scenarios.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'

type Options = { options: { kind: string; currentValue: string }[] }

export const mcpDefaultsScenarios: Scenario[] = [
  {
    name: 'nuphos_ask with no settings starts on the last app Task’s agent, model settings and Full Access',
    run: async (_page, stack) => {
      const as = client(stack.apiUrl, stack.token)
      const { tool } = mcp(as)
      const runtimes = await tool<{ runtimes: { runtime_id: string }[] }>('nuphos_list_runtimes', {
        team_id: stack.teamId,
      })
      const runtimeId = runtimes.structuredContent?.runtimes[0]?.runtime_id

      must(typeof runtimeId === 'string', `an agent to run on, got ${JSON.stringify(runtimes)}`)
      // A Task as the app's composer starts one: an agent, a model and effort, and Full Access.
      const app = randomUUID()
      const sent = await fetch(`${stack.apiUrl}/agent/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: app,
          teamId: stack.teamId,
          runtimeId,
          // The fixture agent offers a model and fast mode; effort takes the same path on agents with one.
          initialSessionConfig: { model: 'fixture-small', fast: 'on' },
          permissionMode: 'bypass',
          messages: [
            {
              id: randomUUID(),
              role: 'user',
              parts: [{ type: 'text', text: 'From the app E2E_DELIVERY:app-defaults' }],
            },
          ],
        }),
      })

      must(sent.ok, `the app Task to start, got ${String(sent.status)}`)
      await sent.text()
      await until('the app Task to answer', async () => {
        const checked = await tool<{ answer?: string }>('nuphos_check', { session_id: app })

        return checked.structuredContent?.answer?.includes('ACK E2E_DELIVERY:app-defaults')
      })
      const viaMcp = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-defaults')
      const asked = await tool<{ session_id: string }>('nuphos_ask', {
        prompt: 'From MCP, asking to approve each call',
        team_id: stack.teamId,
        full_access: false,
        wait: false,
      })
      const approving = asked.structuredContent?.session_id ?? ''
      const settings = async (sessionId: string) => {
        const config = await as(
          'GET',
          `/agent/conversations/${sessionId}/model-config?teamId=${stack.teamId}`,
        )
        const { options } = config.body as Options
        const value = (kind: string) => options.find((option) => option.kind === kind)?.currentValue
        const view = await as('GET', `/agent/conversations/${sessionId}?teamId=${stack.teamId}`)
        const mode = await as('GET', `/agent/auto-mode/bypass?sessionId=${sessionId}`)

        return JSON.stringify({
          runtimeId: (view.body as { runtimeId?: string }).runtimeId,
          model: value('model'),
          fast: value('fast'),
          fullAccess: (mode.body as { bypass: boolean }).bypass,
        })
      }
      const expected = await settings(app)

      must(
        expected ===
          JSON.stringify({ runtimeId, model: 'fixture-small', fast: 'on', fullAccess: true }),
        `the app Task on its chosen settings, got ${expected}`,
      )
      must(
        (await settings(viaMcp)) === expected,
        `the MCP Task to start as the app Task, got ${await settings(viaMcp)} vs ${expected}`,
      )
      await until('the approving Task to be stored', async () =>
        (await settings(approving)).includes('"fullAccess":false'),
      )
    },
  },
]
