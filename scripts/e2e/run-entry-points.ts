// `bun run e2e:entry-points`: every way into the product from #4205, each on its
// own. Unlike `run.ts`, one failure does not end the run: a removed way in should
// name itself in the report, and so should the four that are still there.
import { startDesktop } from './desktop.ts'
import { entryPointScenarios } from './entry-point-scenarios.ts'
import { artifacts, stopAll } from './processes.ts'
import { startStack } from './stack.ts'
import { send } from './ui.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  const { page } = desktop

  page.setDefaultTimeout(30_000)
  // Signed in, with a Bot and a Task: the screens these ways in start from.
  await page.locator('input[type=email]').fill(stack.email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
  await page.getByText('Start with your first Bot').waitFor()
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('textbox', { name: 'Bot name' }).fill('E2E Entry Bot')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: 'Bot details' }).first().waitFor()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  await send(page, 'Entry points E2E_DELIVERY:entry')
  await page.getByText('ACK E2E_DELIVERY:entry').waitFor()

  const failures: string[] = []

  for (const [index, scenario] of entryPointScenarios.entries()) {
    try {
      await scenario.run(page, stack)
      console.log(`PASS ${scenario.name}`)
    } catch (error) {
      failures.push(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`FAIL ${scenario.name}`)
      console.error(error)
    }
    await page.screenshot({ path: `${artifacts}/entry-point-${String(index + 1)}.png` })
    // The next scenario navigates from the sidebar, so only a menu or dialog
    // this one left open has to go.
    await page.keyboard.press('Escape')
  }
  if (failures.length > 0) {
    failed = true
    const total = String(entryPointScenarios.length)

    console.error(`FAIL ${String(failures.length)} of ${total} ways in:`)
    for (const failure of failures) console.error(`  ${failure}`)
  } else {
    console.log(`PASS all ${String(entryPointScenarios.length)} ways into the product`)
  }
} catch (error) {
  failed = true
  console.error(error)
  if (desktop) await desktop.page.screenshot({ path: `${artifacts}/entry-points-failed.png` })
  console.error(`FAIL: logs and the last screenshot are in ${artifacts}`)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
