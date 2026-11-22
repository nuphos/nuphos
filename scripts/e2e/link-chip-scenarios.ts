// A link to an agent session shows as a chip with the agent's name and face.
import { client } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const linkChipScenarios: Scenario[] = [
  {
    // The chip reads the Bot without its messages, as a long session holds tens of thousands.
    name: "a link to a Bot shows as a chip with the Bot's name and face",
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const { conversations } = (
        await api('GET', `/agent/conversations?teamId=${stack.teamId}&bots=true`)
      ).body as { conversations: { sessionId: string; title?: string; avatar?: string }[] }
      const bot = conversations.find((row) => row.title === 'E2E Bot')

      if (!bot?.avatar)
        throw new Error(`No E2E Bot with an avatar: ${JSON.stringify(conversations)}`)
      await newTask(page)
      await send(
        page,
        `Ask https://nuphos.ai/teams/${stack.teamId}/agent/${bot.sessionId} E2E_DELIVERY:chip`,
      )
      await page.getByText('ACK E2E_DELIVERY:chip').waitFor()
      const chip = page.locator('.user-message-bubble:visible .atlas-mention').last()

      await chip.locator('.atlas-mention-label', { hasText: 'E2E Bot' }).waitFor()
      await chip.locator('img.atlas-mention-avatar').waitFor()
      await page.screenshot({ path: `${artifacts}/bot-link-chip.png` })
    },
  },
]
