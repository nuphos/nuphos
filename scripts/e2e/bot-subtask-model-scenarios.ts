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
      // The sub-Task answers only once this exists: the sidebar lists a sub-Task while it runs,
      // and a fixture turn is shorter than the session list's 4 s poll.
      const release = join(artifacts, 'release')
      const light = () =>
        page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })

      await page.getByRole('tab', { name: 'Bots' }).click()
      await bot.click()
      // The sub-Task's session runs a model the agent's own list never offers.
      writeFileSync(behind, 'fixture-unlisted')
      rmSync(release, { force: true })
      try {
        await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:unlisted-handoff')
        // A running sub-Task is listed under the Bot once its tree is open. Opened from there,
        // it stays listed when it finishes, since it is the open chat.
        const tree = bots.locator('[aria-label="Show sub-tasks"], [aria-label="Hide sub-tasks"]')

        await tree.first().waitFor()
        if ((await tree.first().getAttribute('aria-label')) === 'Show sub-tasks')
          await tree.first().dispatchEvent('click')
        await kid.click()
        writeFileSync(release, '')
        await until('the sub-Task to reply', async () =>
          agentEvents(stack).includes('finish E2E_DELIVERY:unlisted-kid'),
        )
        await page.getByText('ACK E2E_DELIVERY:unlisted-kid').waitFor()
        const chip = page.getByRole('button', { name: /^Model settings/ }).last()

        // Opened while it ran, its chip names the model once the app reads it after the turn.
        await until("the sub-Task's chip to name its model", async () =>
          (await chip.getAttribute('aria-label'))?.startsWith('Model settings: fixture-unlisted'),
        )
        await light()
        await page.screenshot({ path: `${artifacts}/bot-subtask-model-light.png` })
      } finally {
        // Kept until the chip names the model: the app reads it again once the sub-Task ends.
        rmSync(behind, { force: true })
        rmSync(release, { force: true })
      }
      // Back in the Bot's chat, where the channel scenarios carry on. The finished sub-Task
      // leaves the sidebar with no count in its place, so the Bot's name has the row's width.
      await bot.click()
      await kid.waitFor({ state: 'detached' })
      await page.mouse.move(600, 400)
      await page.waitForTimeout(3_000)
      await light()
      await bots.screenshot({ path: `${artifacts}/bot-row-light.png` })
      if (await bots.locator('[title$=" done"]').count())
        throw new Error("The Bot's row still shows a done count")
    },
  },
]
