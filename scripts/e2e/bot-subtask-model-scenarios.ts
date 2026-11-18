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
      // A finished sub-Task is listed under its Bot once the Bot shows its sub-agents and
      // its done count is opened; each is clicked only while it still hides the sub-Task.
      const openKid = async () => {
        for (const reveal of [
          bots.getByRole('button', { name: 'Show sub-agents' }),
          bots.getByTitle(/sub-agents? done$/),
        ]) {
          await page.waitForTimeout(1_000)
          if (!(await kid.isVisible()) && (await reveal.first().isVisible()))
            await reveal.first().click()
        }
        await kid.click()
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      await openKid()
      await page
        .getByRole('button', { name: /^Model settings: / })
        .last()
        .waitFor()
      const before = (await chip.getAttribute('aria-label')) ?? ''
      const model = /^Model settings: ([^\s,]+)/.exec(before)?.[1] ?? ''

      // From now on the agent's list lacks the model the sub-Task runs on.
      writeFileSync(behind, model)
      try {
        // Opened again, the chip reads the list again.
        await bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
        await openKid()
        await page.waitForTimeout(5_000)
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/bot-subtask-model-light.png` })
        const after = (await chip.getAttribute('aria-label')) ?? ''

        if (after !== before) throw new Error(`The chip read "${before}", then "${after}"`)
      } finally {
        rmSync(behind, { force: true })
      }
      // Back in the Bot's chat, where the channel scenarios carry on.
      await bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    },
  },
]
