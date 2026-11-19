// #3963: list_agent_runtimes lists the agents on the owner's own computer, so a thread can run there.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

/** What the app reports of the computer it runs on. */
type AppComputer = { deviceId?: string; connection?: string }

export const threadRuntimeScenarios: Scenario[] = [
  {
    name: "list_agent_runtimes lists the agents on the owner's own computer",
    run: async (page, stack) => {
      let deviceId = ''

      await until('the app to be online as its computer', async () => {
        const state = await page.evaluate(() =>
          (window as unknown as { api: { localRuntimeGetState: () => Promise<AppComputer> } }).api
            .localRuntimeGetState()
            .catch(() => null),
        )

        deviceId = state?.connection === 'online' ? (state.deviceId ?? '') : ''

        return deviceId
      })
      const before = agentLog(stack).length
      const args = { label: 'List the agents' }

      await newTask(page)
      await send(
        page,
        `List E2E_CALL list_agent_runtimes ${JSON.stringify(args)} E2E_DELIVERY:runtimes`,
      )
      await page.getByText('ACK E2E_DELIVERY:runtimes').waitFor()
      const answer = JSON.stringify(
        agentLog(stack)
          .slice(before)
          .find((entry) => entry.event === 'called')?.result,
      )

      writeFileSync(join(artifacts, 'list-agent-runtimes.json'), answer)
      if (!answer.includes(`_${deviceId}`))
        throw new Error(`The app's computer ${deviceId} is not listed: ${answer}`)
    },
  },
]
