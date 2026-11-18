// The model a Bot's sub-Task names in its chip, in the chat of the Bot an earlier scenario created.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const botSubtaskModelScenarios: Scenario[] = [
  {
    // #3409: a sub-Task on a model its computer's list lacked named no model in its chip.
    name: "a Bot's sub-Task names its model when its computer's list lacks it",
    run: async (page, stack) => {
      const bots = page.getByRole('tabpanel', { name: 'Bots' })
      const bot = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      const kid = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E unlisted kid' }).first()
      const behind = join(artifacts, 'behind')
      // The Bot's controls hide while its row is hovered, so each is clicked where it is.
      const toggle = async (control: string) => {
        await page.mouse.move(120, 600)
        await page.waitForTimeout(1_000)
        await bots.locator(control).first().dispatchEvent('click')
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      await bot.click()
      // The sub-Task's session runs a model the agent's own list never offers.
      writeFileSync(behind, 'fixture-unlisted')
      try {
        await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:unlisted-handoff')
        await until('the sub-Task to reply', async () =>
          agentEvents(stack).includes('finish E2E_DELIVERY:unlisted-kid'),
        )
      } finally {
        rmSync(behind, { force: true })
      }
      // The Bot's row once its sub-Task finished.
      await page.mouse.move(600, 400)
      await page.waitForTimeout(3_000)
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await bots.screenshot({ path: `${artifacts}/bot-row-light.png` })
      // A finished sub-Task is listed once the Bot's done count is opened, which gives the Bot
      // sub-agents to show, and then they are shown.
      await toggle('[title$=" done"]')
      if (!(await kid.count())) await toggle('[aria-label="Show sub-agents"]')
      await kid.click()
      await page.getByText('ACK E2E_DELIVERY:unlisted-kid').waitFor()
      await page.waitForTimeout(3_000)
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.screenshot({ path: `${artifacts}/bot-subtask-model-light.png` })
      const chip = page.getByRole('button', { name: /^Model settings/ }).last()
      const label = (await chip.getAttribute('aria-label')) ?? ''

      if (!label.startsWith('Model settings: fixture-unlisted'))
        throw new Error(`The sub-Task's chip reads "${label}"`)
      // Back in the Bot's chat, its done group closed again, where the channel scenarios carry on.
      await bot.click()
      await toggle('[title$=" done"]')
      await kid.waitFor({ state: 'detached' })
    },
  },
]
