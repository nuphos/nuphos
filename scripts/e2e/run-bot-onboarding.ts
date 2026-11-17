import { mkdirSync, writeFileSync } from 'node:fs'

import { botOnboardingScenarios } from './bot-onboarding-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
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
  const cdp = await desktop.page.context().newCDPSession(desktop.page)

  mkdirSync(`${artifacts}/frames`, { recursive: true })
  let frame = 0
  const times: { file: string; timestamp: number }[] = []

  cdp.on('Page.screencastFrame', (event) => {
    const file = `frames/${String(frame++).padStart(5, '0')}.jpg`

    writeFileSync(`${artifacts}/${file}`, Buffer.from(event.data, 'base64'))
    times.push({ file, timestamp: event.metadata.timestamp ?? Date.now() / 1000 })
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 75,
    maxWidth: 1440,
    maxHeight: 1000,
    everyNthFrame: 2,
  })
  try {
    for (const scenario of botOnboardingScenarios) {
      await scenario.run(desktop.page, stack)
      console.log(`PASS ${scenario.name}`)
    }
  } finally {
    await cdp.send('Page.stopScreencast')
    writeFileSync(
      `${artifacts}/frames.txt`,
      times
        .map(
          (frame, index) =>
            `file '${frame.file}'\nduration ${Math.min(3, Math.max(0.04, (times[index + 1]?.timestamp ?? frame.timestamp + 1) - frame.timestamp))}`,
        )
        .join('\n'),
    )
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close()
  await stopAll()
}
process.exit(failed ? 1 : 0)
