// A Claude Code native sub-agent's steps group under the call that spawned it (#1060).
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

// Every animation that ends has ended; looping ones (a shimmer, typing dots) never do.
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  )

export const subagentScenarios: Scenario[] = [
  {
    name: "a native sub-agent's steps sit under its own row, apart from the main agent's",
    run: async (page) => {
      await newTask(page)
      await send(page, 'Look into billing E2E_SUBAGENT E2E_DELIVERY:subagent')
      await page.getByText('ACK E2E_DELIVERY:subagent').waitFor()
      await page
        .getByRole('button', { name: /^Worked for/ })
        .last()
        .click()

      // The row keeps the sub-agent's task after its own steps land, and counts them.
      const run = page.getByRole('button', { name: /Survey the billing module.*3 calls/ })
      const main = page.getByRole('button', { name: /^Check the release notes/ })

      await run.waitFor()
      await main.waitFor()
      // Each row fades in, and Playwright counts it visible before it shows.
      await settled(page)
      await page.screenshot({ path: `${artifacts}/subagent-collapsed.png` })
      await run.click()
      const steps = run.locator('xpath=following-sibling::div[1]')

      await steps.getByText('Find invoice totals').waitFor()
      await steps.getByText('Read the tax rules').waitFor()
      if ((await steps.getByText('Check the release notes').count()) > 0)
        throw new Error("The main agent's step is listed under the sub-agent")
      await settled(page)
      await page.screenshot({ path: `${artifacts}/subagent-expanded.png` })
    },
  },
]
