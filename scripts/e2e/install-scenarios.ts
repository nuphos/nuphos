// Adding Claude Code to a computer that does not have it installs it, then signs it in (#3244).
// The installer is fixture-install.sh, so no vendor's CLI is downloaded.
import { join } from 'node:path'

import { artifacts } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** What the person sees at this step, once anything fading in has settled. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, `install-${name}.png`) })
}

/** Claude's authorize page is never opened: its code is typed in, as the person pastes it. */
async function pasteCode(page: Page, name: string) {
  const code = page.getByPlaceholder('Paste code')

  await code.waitFor({ timeout: 60_000 })
  await shot(page, name)
  await code.fill('e2e-code#e2e-state')
  await page.keyboard.press('Enter')
}

export const installScenarios: Scenario[] = [
  {
    // Yuanlin's case: from one computer, adding an agent to another that lacks its CLI.
    name: 'adding Claude Code to another computer without it installs it there, then signs it in',
    run: async (page, stack) => {
      const label = 'E2E Mac mini'
      const computer = await startSecondComputer(stack, label)

      try {
        await openComputers(page)
        await page.getByRole('button', { name: `New runtime on ${label}` }).click()
        await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click()
        await shot(page, 'remote-1-settings')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText(`Installing Claude Code on ${label}…`).waitFor({ timeout: 60_000 })
        await shot(page, 'remote-2-installing')
        await pasteCode(page, 'remote-3-sign-in')
        await page.getByText(/is now signed in/).waitFor({ timeout: 60_000 })
        await shot(page, 'remote-4-added')
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        await computer.stop()
      }
    },
  },
  {
    // On the computer itself: its own Claude Code, from Settings › Local runtime. Last, since
    // the app's computer has Claude Code from here on.
    name: 'this computer without Claude Code installs it from its settings, then signs it in',
    run: async (page) => {
      await openComputers(page)
      await page.getByRole('button', { name: 'Set up' }).first().click()
      const install = page.getByRole('button', { name: 'Install Claude Code' })

      await install.waitFor()
      await shot(page, 'local-1-not-installed')
      await install.click()
      await page.getByText('Claude Code installed').waitFor({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Sign in with Claude Code' }).click()
      // This computer's own sign-in says first that it is kept apart from the terminal's.
      await page.getByRole('button', { name: 'Sign in with Claude', exact: true }).click()
      // This computer's own sign-in takes the code in a dialog of its own.
      const code = page.getByRole('dialog').getByRole('textbox')

      await code.waitFor({ timeout: 60_000 })
      await shot(page, 'local-2-sign-in')
      await code.fill('e2e-code#e2e-state')
      await page.getByRole('button', { name: 'Submit code' }).click()
      await page.getByText('Signed in to Claude Code.').waitFor({ timeout: 60_000 })
      await shot(page, 'local-3-signed-in')
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
]
