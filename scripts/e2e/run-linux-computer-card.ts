// #5321 on a non-Box Linux computer. Run with: xvfb-run bun scripts/e2e/run-linux-computer-card.ts
import { backendFailures, backendLines } from './backend-log.ts'
import { startDesktop } from './desktop.ts'
import { linuxComputerCardScenarios } from './linux-computer-card-scenarios.ts'
import { artifacts, stopAll } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

let failed = false
let desktop: Awaited<ReturnType<typeof startDesktop>> | undefined

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const scenario of [...signInScenarios, ...linuxComputerCardScenarios]) {
    const from = backendLines()

    await scenario.run(desktop.page, stack, desktop)
    const failures = backendFailures(from, scenario.expected)

    if (failures.length > 0)
      throw new Error(`"${scenario.name}" made the backend fail:\n${failures.join('\n')}`)
    console.log(`PASS ${scenario.name}`)
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
