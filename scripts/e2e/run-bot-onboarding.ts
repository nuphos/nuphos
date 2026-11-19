import { botOnboardingScenarios } from './bot-onboarding-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { recordScreencast } from './screencast.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ botOnboarding: true })

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const scenario of signInScenarios) await scenario.run(desktop.page, stack)
  const { page } = desktop

  await recordScreencast(page, 'frames', async () => {
    for (const scenario of botOnboardingScenarios) {
      await scenario.run(page, stack)
      console.log(`PASS ${scenario.name}`)
    }
  })
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close()
  await stopAll()
}
process.exit(failed ? 1 : 0)
