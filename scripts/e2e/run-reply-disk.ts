import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { replyDiskScenario } from './reply-disk-scenario.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false

try {
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl, { name: 'reply-disk-4355' })
  const page = desktop.page

  page.setDefaultTimeout(30_000)
  for (const scenario of signInScenarios) await scenario.run(page, stack)
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('textbox', { name: 'Bot name' }).fill('E2E Bot')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByText('POSTED E2E_DELIVERY:missing', { exact: true }).waitFor({ timeout: 90_000 })
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await replyDiskScenario(page, stack)
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
console.log(`Artifacts: ${artifacts}`)
if (failed) process.exitCode = 1
