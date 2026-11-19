// A turn that fails on a computer with a Nuphos update waiting. In Slack and channels, where no
// banner shows, the failed turn's own line is the only notice (#3562).
import { join } from 'node:path'

import { LAPTOP, RESTORE_FAILED, laptopOnline } from './laptop-fixture.ts'
import { artifacts } from './processes.ts'
import { newTask, pickInSubmenu, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

// What the conversation shows for a failed turn there: its summary, then the out-of-date line.
export const OUTDATED_LINE =
  'The agent failed before it could answer. Nuphos on the computer running this agent is out of date. Update it there, then try again.'

// A new task starts on the runtime the last message went to. Sending one on the fixture agent
// keeps the scenarios after these off the laptop, which has gone offline by then.
export async function backOnFixture(page: Page, marker: string) {
  await newTask(page)
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await page.getByRole('menu').getByText('E2E fixture agent').click()
  await pickInSubmenu(page, page.getByRole('menuitem', { name: /^E2E fixture agent.*Claude Code/ }))
  await send(page, `Back on the fixture E2E_DELIVERY:${marker}`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
}

export const outdatedTurnScenarios: Scenario[] = [
  {
    // #3560: a Desktop above the floor with an update downloaded failed every turn on a runtime
    // bug the update fixed, and nothing said an update would help (#3562).
    name: 'a turn that fails on a computer with a Nuphos update waiting says to update it',
    // The turn there fails on purpose.
    expected: new RegExp(RESTORE_FAILED),
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.127.0',
        app: { version: '0.127.0', update: { version: '0.131.0', ready: true } },
        restoreFails: true,
      })

      try {
        // A new task starts on the laptop, whichever runtime the last one used.
        await newTask(page)
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
        await send(page, 'On the laptop behind the latest release')
        await page.getByText(OUTDATED_LINE).waitFor()
        await page.screenshot({ path: join(artifacts, 'behind-turn-error.png') })
        await backOnFixture(page, 'after-behind')
      } finally {
        goOffline()
      }
    },
  },
]
