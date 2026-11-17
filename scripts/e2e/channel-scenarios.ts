// Scenarios about a Bot reading its chat. They run in the Bot chat the scenario before opened.
import { agentEvents, agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const channelScenarios: Scenario[] = [
  {
    // #2949: channel_read in a woken turn returned the page the notice had shown, not the rest.
    name: 'a Bot woken by more than a page of posts reads on to the newest one',
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail
      const post = async (text: string) => {
        const response = await fetch(
          `${stack.apiUrl}/agent/conversations/${channelId ?? ''}/channel-messages`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${stack.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ teamId: stack.teamId, text }),
          },
        )

        if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
      }

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      // The first keeps the Bot busy, so the next 52 wait for one notice of more than a page.
      await post('Hold on E2E_SLOW E2E_DELIVERY:slow')
      for (let n = 0; n < 51; n++) await post(`Burst ${String(n)}`)
      await post('The newest E2E_DELIVERY:newest')
      // The Bot posts only once it has read on, so any repeat is logged by now.
      await page.getByText('POSTED E2E_DELIVERY:newest', { exact: true }).waitFor()
      const repeats = agentLog(stack).filter((entry) => entry.event === 'channel-repeat')

      if (repeats.length > 0) {
        throw new Error(
          `channel_read returned posts the notice had shown: ${JSON.stringify(repeats)}`,
        )
      }
    },
  },
  {
    // #3246: every Bot post was headed by the Bot's name and an "Agent" tag.
    name: "a Bot's posts are headed by its name, with no Agent tag",
    run: async (page) => {
      const posts = page.locator('[data-post-id]')

      await posts.first().waitFor()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.screenshot({ path: `${artifacts}/bot-post-header-light.png` })
      const tags = await posts.getByText('Agent', { exact: true }).count()

      if (tags > 0) throw new Error(`${String(tags)} Bot posts carry an Agent tag`)
    },
  },
  {
    // #3171: a busy Bot's row showed what the Bot last told its owner, never posted in its chat.
    name: 'a Bot that posts twice and works on shows dots in its row, then its newest post',
    run: async (page, stack) => {
      const row = page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      const ownWords = async (when: string) => {
        // The fixture's own turn text, which only the Bot's transcript holds.
        if ((await row.getByText(/ACK E2E_DELIVERY/).count()) > 0)
          throw new Error(`${when}, the Bot's row shows the Bot's own transcript`)
      }

      // Setup has its own status line. Finish it before checking an established Bot's dots.
      await send(
        page,
        'Confirmed: review releases. E2E_ONBOARDING_COMPLETE E2E_DELIVERY:busy-bot-setup',
      )
      await until('the Bot setup turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:busy-bot-setup'),
      )
      await row.getByText('Getting started', { exact: true }).waitFor({ state: 'hidden' })
      await send(page, 'Post twice E2E_TWO_POSTS E2E_DELIVERY:two')
      await page.getByText('POSTED E2E_DELIVERY:two', { exact: true }).waitFor()
      // Still in its turn: the row has the work dots.
      await row.locator('.t-typing-dot').first().waitFor()
      await page.screenshot({ path: `${artifacts}/bot-row-busy-light.png` })
      await ownWords('While the Bot works')
      await until('the two-post turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:two'),
      )
      await row.getByText('POSTED E2E_DELIVERY:two').waitFor()
      await page.screenshot({ path: `${artifacts}/bot-row-idle-light.png` })
      await ownWords('After the turn')
    },
  },
  {
    // #3309: Switch runtime in a Bot's own failed turn also opened its chat's list, underneath.
    name: "Switch runtime on a Bot's failed turn opens one runtime list",
    run: async (page) => {
      await send(page, 'Out of usage E2E_USAGE_LIMIT E2E_DELIVERY:bot-usage')
      await page.getByTitle('Open session').click()
      const task = page.locator('.t-bot-task-mode')

      await task.getByText('You’ve hit your usage limit').last().waitFor()
      await task.getByRole('button', { name: 'Switch runtime' }).click()
      const lists = page.getByRole('menu')

      await lists.first().waitFor()
      // Long enough for a second list to have opened, had there been one.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await page.screenshot({ path: `${artifacts}/bot-turn-switch-runtime-light.png` })
      const open = await lists.count()

      await page.keyboard.press('Escape')
      await task.getByRole('button', { name: 'Back to conversation' }).click()
      if (open !== 1) throw new Error(`Switch runtime opened ${String(open)} runtime lists`)
    },
  },
]
