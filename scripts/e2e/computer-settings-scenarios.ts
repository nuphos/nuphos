// This computer's own settings live in its card's Settings…, now that Settings has no Local
// runtime page: Open Nuphos at login, Prevent Mac auto-sleep and the workspace folder.
import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const SLEEP = 'Prevent Mac auto-sleep'
const POWER = 'Only while connected to power'

async function openSettings(page: Page) {
  await openComputers(page)
  await page.getByRole('button', { name: `Manage ${hostname()}` }).click()
  await page.getByRole('menuitem', { name: 'Settings…' }).click()
  await page.getByRole('switch', { name: 'Install updates automatically' }).waitFor()
}

async function close(page: Page) {
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByText('Back to app', { exact: true }).click()
}

export const computerSettingsScenarios: Scenario[] = [
  {
    name: "this computer's Settings… reads, changes and keeps its sleep setting, and shows its workspace",
    run: async (page, _stack, desktop) => {
      const state = await page.evaluate(() => window.api.localRuntimeGetState())
      const login = await page.evaluate(() => window.api.appGetLoginItem())

      await openSettings(page)
      // Each setting shows where its computer supports it: login items need a packaged app.
      if ((await page.getByText('Open Nuphos at login').count()) !== (login.supported ? 1 : 0))
        throw new Error(`Open Nuphos at login shown though supported is ${String(login.supported)}`)
      if (state.workspace)
        await page.getByText(state.workspace, { exact: true }).waitFor({ timeout: 10_000 })
      const sleep = state.sleepPrevention

      if (!sleep?.supported) {
        if ((await page.getByRole('combobox', { name: SLEEP }).count()) > 0)
          throw new Error('The sleep setting is shown on a computer that cannot keep it')
        console.log('SKIP sleep prevention is macOS only')
        await close(page)

        return
      }
      const file = join(desktop!.profile, 'sleep-prevention.json')
      const kept = () =>
        existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as typeof sleep) : undefined
      const mode = sleep.mode === 'host' ? 'tasks' : 'host'
      const name = { host: 'While signed in to Nuphos', tasks: 'While local tasks are running' }

      try {
        await page.getByRole('combobox', { name: SLEEP }).click()
        await page.getByRole('option', { name: name[mode] }).click()
        await until(`sleep-prevention.json to say ${mode}`, async () => kept()?.mode === mode)
        await page.getByRole('switch', { name: POWER }).click()
        await until(
          'sleep-prevention.json to keep the power switch',
          async () => kept()?.onlyOnAC === !sleep.onlyOnAC,
        )
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'computer-settings-this-computer.png') })
        await close(page)

        // Reopened after a reload, the dialog reads what the computer kept.
        await page.reload()
        await openSettings(page)
        await page
          .getByRole('combobox', { name: SLEEP })
          .filter({ hasText: name[mode] })
          .waitFor({ timeout: 10_000 })
        const power = await page.getByRole('switch', { name: POWER }).getAttribute('aria-checked')

        if (power !== String(!sleep.onlyOnAC)) throw new Error(`The power switch reads ${power}`)
        await close(page)
      } finally {
        await page.evaluate(
          ({ mode, onlyOnAC }) => window.api.localRuntimeSetSleepPreferences({ mode, onlyOnAC }),
          { mode: sleep.mode, onlyOnAC: sleep.onlyOnAC },
        )
      }
    },
  },
]
