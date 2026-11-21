// Runs on a disposable mounted filesystem, with the real Electron device metrics and backend.
import { existsSync, readFileSync, statfsSync } from 'node:fs'
import { join } from 'node:path'

import { startDesktop } from './desktop.ts'
import { installScenarios } from './install-scenarios.ts'
import { artifacts, logPath, stopAll, until } from './processes.ts'
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
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await page.getByRole('menu').getByText('E2E Studio', { exact: true }).click()
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
  const page = desktop.page

  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  for (const scenario of signInScenarios) await scenario.run(page, stack)
  // This installs the deterministic fixture agent on the real Desktop computer.
  await installScenarios[2]!.run(page, stack)
  let deviceId = ''

  await until('the Desktop computer to connect', async () => {
    const state = await page.evaluate(() =>
      (
        window as unknown as {
          api: { localRuntimeGetState: () => Promise<{ deviceId?: string; connection?: string }> }
        }
      ).api.localRuntimeGetState(),
    )

    deviceId = state.connection === 'online' ? (state.deviceId ?? '') : ''

    return deviceId
  })
  const renamed = await fetch(`${stack.apiUrl}/agent/devices/${deviceId}?teamId=${stack.teamId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'E2E Studio' }),
  })

  if (!renamed.ok) throw new Error(`Renaming the fictional computer failed: ${renamed.status}`)
  await page.reload()
  // Reproduce the original path: create the Task directly on the nearly full local runtime.
  await newTask(page)
  await chooseLocal(page)
  await send(page, 'Prepare the fictional release E2E_DELIVERY:disk-first')
  const failure = page.getByText('Turn failed', { exact: false }).first()

  await failure.waitFor({ timeout: 120_000 })
  console.log('OBSERVED TURN FAILURE:', await failure.innerText())
  await screenshot(page, 'turn-failure')
  await page.waitForTimeout(5_000)
} catch (error) {
  failed = true
  console.error(error)
  if (!desktop && existsSync(logPath('real-disk')))
    console.error(
      `Desktop startup log:\n${readFileSync(logPath('real-disk'), 'utf8').slice(-8_000)}`,
    )
  if (desktop) await screenshot(desktop.page, 'failure').catch(() => {})
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
