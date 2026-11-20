// Runs on a disposable mounted filesystem, with the real Electron device metrics and backend.
import { rmSync, statfsSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { startDesktop } from './desktop.ts'
import { installScenarios } from './install-scenarios.ts'
import { artifacts, stopAll } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'
import { newTask, pickInSubmenu, send } from './ui.ts'

import type { Desktop } from './desktop.ts'
import type { Page } from 'playwright-core'

const diskHome = process.env.E2E_DISK_HOME
const fill = process.env.E2E_DISK_FILL

if (!diskHome || !fill) throw new Error('A dedicated disk mount and fill file are required')

function usedPercent() {
  const fs = statfsSync(diskHome!)

  return (100 * (fs.blocks - fs.bfree)) / fs.blocks
}

async function chooseLocal(page: Page) {
  await newTask(page)
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await page.getByRole('menu').getByText(hostname(), { exact: true }).click()
  await pickInSubmenu(page, page.getByRole('menuitem', { name: /^Claude Code/ }))
}

const screenshot = (page: Page, name: string) =>
  page.screenshot({ path: join(artifacts, `real-disk-${name}.png`) })

let desktop: Desktop | undefined
let failed = false

try {
  const percent = usedPercent()

  if (percent < 93) throw new Error(`Dedicated filesystem is only ${percent.toFixed(1)}% used`)
  console.log(`Real statfs before Desktop: ${percent.toFixed(1)}% used`)
  const stack = await startStack()
  const options = { name: 'real-disk', suffix: 'e2e-real-disk', env: { HOME: diskHome } }

  desktop = await startDesktop(stack.apiUrl, options)
  let page = desktop.page

  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  for (const scenario of signInScenarios) await scenario.run(page, stack)
  // This installs the deterministic fixture agent on the real Desktop computer.
  await installScenarios[2]!.run(page, stack)
  await chooseLocal(page)
  await send(page, 'Prepare the fictional release E2E_DELIVERY:disk-first')
  await page.getByText('ACK E2E_DELIVERY:disk-first').waitFor({ timeout: 60_000 })
  const warning = (p: Page) => p.getByRole('status').filter({ hasText: 'disk is almost full' })

  await warning(page).waitFor({ timeout: 90_000 })
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await screenshot(page, 'before')
  await warning(page).getByRole('button', { name: 'Dismiss for today' }).click()
  await warning(page).waitFor({ state: 'hidden' })
  await screenshot(page, 'dismissed')

  await chooseLocal(page)
  await send(page, 'Check the fictional changelog E2E_DELIVERY:disk-second')
  await page.getByText('ACK E2E_DELIVERY:disk-second').waitFor({ timeout: 60_000 })
  // Device readings refresh every 60 seconds: observe past a full refresh.
  await page.waitForTimeout(65_000)
  if (await warning(page).isVisible()) throw new Error('Warning returned in another chat')

  const otherWindow = page.context().waitForEvent('page')

  await page.keyboard.press('Control+Shift+N')
  const second = await otherWindow

  await second.waitForLoadState('domcontentloaded')
  await second.getByRole('tab', { name: 'Tasks' }).click()
  await second.getByText('Check the fictional changelog', { exact: false }).first().click()
  await second.waitForTimeout(65_000)
  if (await warning(second).isVisible()) throw new Error('Warning returned in a second window')
  await screenshot(second, 'second-window')

  await desktop.stop()
  desktop = await startDesktop(stack.apiUrl, options)
  page = desktop.page
  page.setDefaultTimeout(30_000)
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByText('Check the fictional changelog', { exact: false }).first().click()
  await page.waitForTimeout(65_000)
  if (await warning(page).isVisible()) throw new Error('Warning returned after restarting Desktop')
  await screenshot(page, 'restarted')

  rmSync(fill)
  if (usedPercent() >= 90) throw new Error('The dedicated filesystem is still at least 90% full')
  // Clear the snooze so absence proves the new real reading, not the earlier dismissal.
  await page.evaluate(() => localStorage.removeItem('nuphos.diskSnooze'))
  await page.waitForTimeout(70_000)
  await page.reload()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByText('Check the fictional changelog', { exact: false }).first().click()
  await page.waitForTimeout(5_000)
  if (await warning(page).isVisible()) throw new Error('Warning remains after freeing space')
  await screenshot(page, 'space-freed')
  console.log(
    `PASS real disk: appeared, dismissed across chats/windows/restart, cleared after freeing space (${usedPercent().toFixed(1)}% used)`,
  )
} catch (error) {
  failed = true
  console.error(error)
  if (desktop) await screenshot(desktop.page, 'failure').catch(() => {})
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
