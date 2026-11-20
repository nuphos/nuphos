// Scenarios about keeping a computer's Nuphos current from its card (#3521): the switch for
// updating by itself, which the computer keeps, and Update on a Box, which installs at once.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { forgetComputer } from './computer-scenarios.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { laptopOnline } from './laptop-fixture.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const SWITCH = 'Install updates automatically'
const SELF_UPDATING = 'E2E self-updating computer'
const OLD_BOX = 'E2E Box on an old CLI'

/** Opens the card's Settings… and returns the switch in it. */
async function settingsSwitch(page: Page, label: string) {
  await page.getByRole('button', { name: `Manage ${label}` }).click()
  await page.getByRole('menuitem', { name: 'Settings…' }).click()

  return page.getByRole('switch', { name: SWITCH })
}

/** Whether a Box's update command (BOX_UPDATE_COMMAND) reached instabox. */
const installed = () =>
  [...instaboxMachines.values()].some((machine) =>
    machine.commands?.some((cmd) => cmd.includes('systemctl --user stop nuphos-agent')),
  )

export const computerUpdateScenarios: Scenario[] = [
  {
    // The switch is the computer's: its host keeps it in auto-update.json, and the card shows
    // what the computer reports, not what the dialog last sent.
    name: "a computer's switch for updating by itself is kept on the computer",
    run: async (page, stack) => {
      const computer = await startSecondComputer(stack, SELF_UPDATING)
      const file = join(computer.home, '.nuphos-agent', 'auto-update.json')
      const kept = () =>
        existsSync(file)
          ? (JSON.parse(readFileSync(file, 'utf8')) as { enabled?: unknown }).enabled
          : undefined

      try {
        for (const enabled of [false, true]) {
          await openComputers(page)
          const toggle = await settingsSwitch(page, SELF_UPDATING)

          // Opened afresh from the Computers page: this is the card reading the computer's report.
          await until(`the switch to show ${String(!enabled)}`, async () => {
            return (await toggle.getAttribute('aria-checked')) === String(!enabled)
          })
          await toggle.click()
          await until(`auto-update.json on the computer to say ${String(enabled)}`, async () => {
            return kept() === enabled
          })
          if (!enabled)
            await page.screenshot({ path: join(artifacts, 'computer-auto-update-off.png') })
          await page.getByRole('button', { name: 'Done' }).click()
          await page.getByText('Back to app', { exact: true }).click()
        }
      } finally {
        await computer.stop()
        forgetComputer(stack.mongoUri, computer.deviceId)
      }
    },
  },
  {
    // A Box on an older CLI: Update on its card runs the install on the Box at once.
    name: 'Update on a Box with an older CLI runs the install on it at once',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, { box: OLD_BOX, cliVersion: '0.0.1' })

      try {
        await openComputers(page)
        await page.getByRole('button', { name: `Manage ${OLD_BOX}` }).click()
        const update = page.getByRole('menuitem', { name: /^Update to v\d/ })

        // The newest release is looked up once the card asks for it.
        await update.waitFor({ timeout: 30_000 })
        await update.click()
        const confirm = page.getByRole('alertdialog')

        await confirm.getByText(`Update ${OLD_BOX}?`).waitFor()
        if (installed()) throw new Error('The install ran before Update was confirmed')
        await page.screenshot({ path: join(artifacts, 'box-update-confirm.png') })
        await confirm.getByRole('button', { name: 'Update and restart' }).click()
        await until('the install to reach the Box', async () => installed())
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        goOffline()
      }
    },
  },
]
