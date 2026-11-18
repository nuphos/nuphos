// #3401: a computer whose agent cannot reach its model API is told what to check, not EPROTO.
import { artifacts } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'

const SENTENCE =
  "This computer couldn't reach the model provider's API. Check its network, proxy or VPN, then resend your message."

export const providerUnreachableScenarios: Scenario[] = [
  {
    name: 'a turn that cannot reach the model API says to check the network, without the raw error',
    run: async (page) => {
      await newTask(page)
      await pickAgent(page, 'E2E fixture agent')
      // The fixture fails it as Claude Code does: -32603, Unable to connect to API (EPROTO).
      await send(page, 'Cannot reach the API E2E_API_UNREACHABLE E2E_DELIVERY:api-unreachable')
      await page.getByText(SENTENCE).first().waitFor()
      await page.screenshot({ path: `${artifacts}/api-unreachable.png` })
      const raw = await page.getByText(/Unable to connect to API|EPROTO/).count()

      if (raw > 0) throw new Error(`The chat shows the raw error ${raw} times`)
    },
  },
]
