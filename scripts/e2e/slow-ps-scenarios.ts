// #5019: a stuck process made every `ps` on a Mac take seconds. Starting openab lists processes,
// and the host sent no frames until `ps` returned, so the backend closed its tunnel (4001).
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { backendLines, backendLog } from './backend-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { startSecondComputer } from './second-computer.ts'
import { fixtureBundle, newTaskOn } from './tunnel-scenarios.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

const LABEL = 'E2E slow ps mini'

export const slowPsScenarios: Scenario[] = [
  {
    name: 'a computer whose ps is slow keeps its tunnel while its agent starts',
    run: async (page, stack) => {
      const computer = await startSecondComputer(stack, LABEL, {
        runtimeDir: fixtureBundle(stack, 'slow-ps'),
        // Each `ps` takes 20 s, longer than the backend waits for a frame (15 s).
        env: {
          NODE_OPTIONS: `--import=${pathToFileURL(join(import.meta.dirname, 'slow-ps.mjs')).href}`,
          E2E_PS_DELAY_S: '20',
        },
      })

      try {
        const from = backendLines()

        await newTaskOn(page, LABEL)
        await send(page, 'Past a slow ps E2E_DELIVERY:slow-ps')
        await page.getByText('ACK E2E_DELIVERY:slow-ps').waitFor({ timeout: 90_000 })
        const closed = backendLog(from).filter(
          (line) =>
            line.includes('tunnel_closed') && line.includes(`"device_id":"${computer.deviceId}"`),
        )

        if (closed.length > 0)
          throw new Error(`The tunnel closed while ps was slow:\n${closed.join('\n')}`)
      } finally {
        await computer.stop()
        // Gone again, so a later Task's "Select all" finds only the computers it did before.
        forgetComputer(stack.mongoUri, computer.deviceId)
      }
    },
  },
]
