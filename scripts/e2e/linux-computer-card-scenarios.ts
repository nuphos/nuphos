// #5321: a Linux computer that is not a Box, running `nuphos agent`. With Xvnc and
// open-computer-use installed its host runs a desktop pool, so a computer card shows the
// conversation's own desktop and Take over works; without them the card is refused.
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { fixtureBundle, newTaskOn } from './tunnel-scenarios.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'E2E Linux server'
const QUESTION = 'Sign in to the example dashboard'
const POOL = process.env.E2E_LINUX_POOL === '1'

async function painted(page: Page) {
  return page.evaluate((question) => {
    const canvas = [
      ...document.querySelectorAll(`[data-decision-question="${question}"] canvas`),
    ].find((each) => each instanceof HTMLCanvasElement && each.width > 0 && each.clientWidth)

    return canvas instanceof HTMLCanvasElement
  }, QUESTION)
}

export const linuxComputerCardScenarios: Scenario[] = [
  {
    name: POOL
      ? 'a Linux computer with a desktop pool hands its desktop over with a computer card'
      : 'a Linux computer without a desktop pool cannot hand a computer card over',
    expected: /\/runtime-desktop\/[^"]+","status":404/u,
    run: async (page, stack) => {
      const computer = await startSecondComputer(stack, LABEL, {
        runtimeDir: fixtureBundle(stack, 'linux-card'),
      })
      const shot = (name: string) =>
        join(artifacts, `linux-card-${POOL ? 'pool' : 'none'}-${name}.png`)

      try {
        await newTaskOn(page, LABEL)
        const call = {
          label: 'Ask',
          category: 'computer',
          question: QUESTION,
          body: 'The site wants a sign-in only you can do.',
        }

        await send(
          page,
          `Ask it E2E_CALL request_user_decision ${JSON.stringify(call)} E2E_DELIVERY:linux-card`,
        )
        await page.getByText('ACK E2E_DELIVERY:linux-card').waitFor({ timeout: 60_000 })
        const log = agentLog(stack)
        const opened = log.filter((entry) => entry.event === 'session').at(-1)
        const result = JSON.stringify(
          log.filter((entry) => entry.name === 'request_user_decision').at(-1)?.result,
        )

        console.log(
          `told no screen: ${opened?.noScreen}; computer card result: ${result.slice(0, 600)}`,
        )
        // The agent is told up front whether a computer card can work here (#5326).
        if (opened?.noScreen !== !POOL)
          throw new Error(`Expected noScreen ${!POOL}, got ${opened?.noScreen}`)
        if (!POOL) {
          if (!result.includes('no desktop to hand over'))
            throw new Error('Expected the no-desktop refusal')
          await page.screenshot({ path: shot('refused') })

          return
        }
        const card = page.locator(`[data-decision-question="${QUESTION}"]:visible`)

        await until('the card to show the desktop live', () => painted(page), 120_000)
        await card.getByText('Live', { exact: true }).waitFor({ timeout: 60_000 })
        await page.waitForTimeout(3000)
        await card.screenshot({ path: shot('1-live') })
        await card.getByRole('button', { name: 'Take over' }).click()
        await page.getByText('You’re in control').waitFor()
        await page.waitForTimeout(2000)
        await page.screenshot({ path: shot('2-in-control') })
        await page.getByRole('button', { name: 'I’m done' }).first().click()
        await page.getByText(/I.m done \(handed back after \S+\)/u).waitFor({ timeout: 30_000 })
        await page.screenshot({ path: shot('3-handed-back') })
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
      } finally {
        await computer.stop()
      }
    },
  },
]
