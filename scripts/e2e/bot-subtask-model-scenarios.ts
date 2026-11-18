// The model a Bot's sub-Task names in its chip, for the sub-Task an earlier scenario left.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

export const botSubtaskModelScenarios: Scenario[] = [
  {
    // #3409: a sub-Task on its Bot's model named none when its computer's list lacked that model.
    name: "a Bot's sub-Task names its model when its computer's list lacks it",
    run: async (page) => {
      const bots = page.getByRole('tabpanel', { name: 'Bots' })
      const kid = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E bot kid' }).first()
      const chip = page.getByRole('button', { name: /^Model settings/ }).last()
      const behind = join(artifacts, 'behind')
      const bot = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      // A finished sub-Task is listed under its Bot once the Bot's done count is opened, which
      // gives the Bot sub-agents to show, and then they are shown. Both controls hide while the
      // row is hovered, so each is clicked where it is, only while the sub-Task is not listed.
      const openKid = async () => {
        for (const reveal of ['[title$=" done"]', '[aria-label="Show sub-agents"]']) {
          await page.mouse.move(120, 600)
          await page.waitForTimeout(1_000)
          const control = bots.locator(reveal).first()

          if (!(await kid.count()) && (await control.count())) await control.dispatchEvent('click')
        }
        await page.waitForTimeout(1_000)
        await kid.click()
      }

      const shot = async (name: string) => {
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/${name}.png` })
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      await openKid()
      await page
        .getByRole('button', { name: /^Model settings: / })
        .last()
        .waitFor()
      await page.waitForTimeout(3_000)
      await shot('bot-subtask-model-first-light')
      const before = (await chip.getAttribute('aria-label')) ?? ''
      const model = /^Model settings: ([^\s,]+)/.exec(before)?.[1] ?? ''

      // From now on the agent's list lacks the model the sub-Task runs on.
      writeFileSync(behind, model)
      try {
        // Opened again, the chip reads the list again.
        await bot.click()
        await openKid()
        await page.waitForTimeout(5_000)
        await shot('bot-subtask-model-light')
        const after = (await chip.getAttribute('aria-label')) ?? ''

        // Named both times, never just "Model settings".
        if (model === 'Model' || after !== before)
          throw new Error(`The chip read "${before}", then "${after}"`)
      } finally {
        rmSync(behind, { force: true })
      }
      // Back in the Bot's chat, its done group closed again, where the channel scenarios carry on.
      await bot.click()
      await page.mouse.move(120, 600)
      await bots.locator('[title$=" done"]').first().dispatchEvent('click')
      await kid.waitFor({ state: 'detached' })
    },
  },
]
