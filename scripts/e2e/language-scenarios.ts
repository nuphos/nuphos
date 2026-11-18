// #3469: the language Nuphos tells an agent to write in, where no person wrote to it.
import { agentLog } from './agent-log.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const languageScenarios: Scenario[] = [
  {
    // #3469: a delegated Task hears only its parent agent's English prompt, yet its owner's
    // questions must come in the language the owner writes.
    name: 'a Task delegated from a conversation in Traditional Chinese is told to write in it',
    run: async (page, stack) => {
      const before = agentLog(stack).length

      await newTask(page)
      await send(page, '請把這件事交給另一個代理處理 E2E_DELEGATE E2E_DELIVERY:delegating-zh')
      await page.getByText('ACK E2E_DELIVERY:delegating-zh', { exact: true }).waitFor()
      await until('the delegated Task to finish', async () =>
        agentLog(stack)
          .slice(before)
          .some((entry) => entry.event === 'finish' && entry.marker === 'E2E_DELIVERY:child'),
      )
      const log = agentLog(stack).slice(before)
      const child = log.find(
        (entry) => entry.event === 'finish' && entry.marker === 'E2E_DELIVERY:child',
      )
      const session = log.find(
        (entry) => entry.event === 'session' && entry.sessionId === child?.sessionId,
      )

      if (!session?.language?.startsWith('Traditional Chinese')) {
        throw new Error(`The delegated Task was told another language: ${JSON.stringify(session)}`)
      }
    },
  },
]
