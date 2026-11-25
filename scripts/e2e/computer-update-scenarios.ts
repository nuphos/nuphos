// Scenarios about keeping a computer's Nuphos current from its card (#3521): the switch for
// updating by itself, which the computer keeps, and Update on a Box, which installs at once.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { backendLines, backendLog } from './backend-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { LAPTOP, laptopOnline } from './laptop-fixture.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const SWITCH = 'Install updates automatically'
const SELF_UPDATING = 'E2E self-updating computer'
const OLD_BOX = 'E2E Box on an old CLI'

/** Opens the card's Settings…, whose switch shows what the card says as it opens. */
async function settingsSwitch(page: Page, label: string) {
  await page.getByRole('button', { name: `Manage ${label}` }).click()
  await page.getByRole('menuitem', { name: 'Settings…' }).click()
  await page.getByRole('switch', { name: SWITCH }).waitFor()
}

// Where Update stops on this stack: starting the install on the Box (resumeBox) needs a URL
// for the Box to dial back on, which this stack does not have (box-scenarios.ts).
const NO_PUBLIC_URL = 'no public URL for a computer from Nuphos to reach'

export const computerUpdateScenarios: Scenario[] = [
  {
    // #5082: Desktop before 0.137.0 does not know Cursor and refused it as an invalid instance.
    name: 'adding an agent a computer is too old for says to update it, and asks the computer nothing',
    run: async (page, stack) => {
      const heard: string[] = []
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.136.0',
        app: { version: '0.136.0' },
        agentInstances: true,
        heard,
      })

      try {
        await openComputers(page)
        await page.getByRole('button', { name: `New runtime on ${LAPTOP}` }).click()
        await page.getByRole('menuitem', { name: /^Cursor/ }).click()
        await page.getByRole('button', { name: 'Continue' }).click()
        await page
          .getByText(
            'Nuphos on this computer is too old to add Cursor. Update it there, then try again.',
          )
          .waitFor()
        await page.screenshot({ path: join(artifacts, 'add-cursor-too-old.png') })
        if (heard.some((message) => message.includes('create') && message.includes('cursor')))
          throw new Error('The computer was asked to add Cursor')
        await page.keyboard.press('Escape')
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        goOffline()
      }
    },
  },
  {
    // The switch is the computer's: its host keeps it in auto-update.json, and the card shows
    // what the computer reports, not what the dialog last sent.
    name: "a computer's switch for updating by itself is kept on the computer",
    run: async (page, stack) => {
      // As the service runs it (agent.rs): only a host that updates itself has the switch.
      // A version past the e2e release (cli-release-stub.ts) never installs one.
      const computer = await startSecondComputer(stack, SELF_UPDATING, {
        env: { NUPHOS_CLI_VERSION: '999.0.0', NUPHOS_CLI_EXE: '/bin/false' },
      })
      const file = join(computer.home, '.nuphos-agent', 'auto-update.json')
      const kept = () =>
        existsSync(file)
          ? (JSON.parse(readFileSync(file, 'utf8')) as { enabled?: unknown }).enabled
          : undefined

      try {
        for (const enabled of [false, true]) {
          await openComputers(page)
          const toggle = page.getByRole('switch', { name: SWITCH })

          // The dialog reads the card once, as it opens, and the computer's report of the last
          // change takes a few seconds to reach the card: reopened until it shows that report.
          await until(`the switch to show ${String(!enabled)}`, async () => {
            await settingsSwitch(page, SELF_UPDATING)
            if ((await toggle.getAttribute('aria-checked')) === String(!enabled)) return true
            await page.getByRole('button', { name: 'Done' }).click()
            await toggle.waitFor({ state: 'detached' })

            return false
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
    // A Box on an older CLI: Update on its card, once confirmed, starts the install on the Box.
    name: 'Update on a Box with an older CLI starts the install on it once confirmed',
    expected: new RegExp(
      `${NO_PUBLIC_URL}|"path":"/teams/[^"]+/agent-runtimes/[^"]+/update","status":503`,
    ),
    run: async (page, stack) => {
      const from = backendLines()
      // The Update request's own error, raised in resumeBox under requestBoxUpdate.
      const started = () =>
        backendLog(from).some(
          (line) =>
            line.includes(NO_PUBLIC_URL) &&
            line.includes('at resumeBox') &&
            line.includes('requestBoxUpdate'),
        )
      const goOffline = await laptopOnline(stack, { box: OLD_BOX, cliVersion: '0.0.1' })

      try {
        await openComputers(page)
        await page.getByRole('button', { name: `Manage ${OLD_BOX}` }).click()
        const update = page.getByRole('menuitem', { name: /^Update to v\d/ })

        // The newest release is fixed for the e2e backend (cli-release-stub.ts).
        await update.waitFor()
        await update.click()
        const confirm = page.getByRole('alertdialog')

        await confirm.getByText(`Update ${OLD_BOX}?`).waitFor()
        if (started()) throw new Error('The install started before Update was confirmed')
        await page.screenshot({ path: join(artifacts, 'box-update-confirm.png') })
        await confirm.getByRole('button', { name: 'Update and restart' }).click()
        await until('the install to start on the Box', async () => started())
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        goOffline()
      }
    },
  },
]
