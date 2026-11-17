// Scenarios about the computer the app runs on: its registration and its tunnel.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { backendLines, backendLog } from './backend-log.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const OPENED = /"agent\.local_runtime\.tunnel_opened".*"device_id":"([^"]+)"/

function forgetComputer(mongoUri: string, deviceId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    await client.db('nuphos_e2e').collection('agent_devices').deleteOne({ deviceId: process.argv[2] })
    await client.close()`

  execFileSync('bun', ['-e', script, mongoUri, deviceId], { cwd: BACKEND_DIR, timeout: 10_000 })
}

export const computerScenarios: Scenario[] = [
  {
    // #3172: removed while its tunnel was down, a running app dialed into 404s until it was restarted.
    name: 'a computer removed while its tunnel is down registers itself again and comes back',
    run: async (_page, stack) => {
      let deviceId: string | undefined

      await until('the app to open its tunnel', async () => {
        deviceId = backendLog()
          .map((line) => OPENED.exec(line)?.[1])
          .findLast(Boolean)

        return deviceId
      })
      const tunnel = `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId!}/runtime-tunnel`
      // Another connection takes the computer, so the app's own tunnel is down and asking back.
      const other = new WebSocket(tunnel, {
        headers: { authorization: `Bearer ${stack.token}` },
      } as unknown as string[])

      await new Promise((opened, failed) => {
        other.addEventListener('open', opened)
        other.addEventListener('error', failed)
      })
      const from = backendLines()

      forgetComputer(stack.mongoUri, deviceId!)
      other.close()
      await until(
        'the app to be refused as unregistered, then to open its tunnel again',
        async () => {
          const lines = backendLog(from)
          const refused = lines.findIndex(
            (line) => line.includes('/runtime-tunnel"') && line.includes('"device_not_found"'),
          )

          return (
            refused >= 0 && lines.slice(refused).some((line) => OPENED.exec(line)?.[1] === deviceId)
          )
        },
      )
    },
  },
]
