import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'
import { xlsxPreviewScenarios } from './xlsx-preview-scenarios.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`XLSX e2e artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl, { env: { NODE_OPTIONS: '--max-old-space-size=1536' } })
  desktop.page.setDefaultTimeout(30_000)
  await desktop.page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await desktop.page.reload()
  for (const scenario of [signInScenarios[1]!, ...xlsxPreviewScenarios]) {
    await desktop.traceNextScenario()
    await scenario.run(desktop.page, stack, desktop)
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
