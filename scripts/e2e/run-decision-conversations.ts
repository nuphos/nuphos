import { decisionConversationScenarios } from './decision-conversation-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const scenario of [...signInScenarios, ...decisionConversationScenarios]) {
    await scenario.run(desktop.page, stack)
    console.log(`PASS ${scenario.name}`)
  }
} catch (error) {
  failed = true
  console.error(error)
  await desktop?.page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {})
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
