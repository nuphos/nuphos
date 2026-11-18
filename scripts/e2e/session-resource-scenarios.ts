// #3554: a refused link reaches the agent with its reason, not a bare "Internal error".
import { must } from './binding-access-scenarios.ts'
import { calledTool } from './computer-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const sessionResourceScenarios: Scenario[] = [
  {
    name: 'linking a pull request through an integration the Task cannot use tells the agent why',
    run: async (page, stack) => {
      const args = {
        label: 'Link the PR',
        resource: { provider: 'github', installationId: 99, repository: 'org/repo', number: 1 },
      }

      await newTask(page)
      await send(
        page,
        `Link it E2E_CALL bind_session_resource ${JSON.stringify(args)} E2E_DELIVERY:bind`,
      )
      await page.getByText('ACK E2E_DELIVERY:bind').waitFor()
      const answer = await calledTool(stack, 'bind_session_resource')

      must(
        answer.includes('Select an accessible integration') && answer.includes('"isError":true'),
        `the refusal's reason as a tool error, got ${answer}`,
      )
    },
  },
]
