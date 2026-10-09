import { z } from 'zod'

import { tunnelBus } from './local-runtime/bus'
import { runtimePresenceStore } from './local-runtime/presence'
import { DeviceRuntimeSocket } from './local-runtime/socket'

import type { DeviceRuntimeSocketDeps } from './local-runtime/socket'

export const LOCAL_EXEC_DISPATCH_TIMEOUT_MS = 40_000
const resultSchema = z.object({
  stdout: z.string().max(1024 * 1024),
  stderr: z.string().max(1024 * 1024),
  exitCode: z.number().int(),
})

export type LocalExecDispatchOutcome =
  | { status: 'ok'; result: z.infer<typeof resultSchema> }
  | { status: 'timeout' }
  | { status: 'device_disconnected' }

/** One command and result on the existing device tunnel; no second presence
 * connection, result POST, Redis result key, or polling loop. */
export function dispatchLocalExec(
  userId: string,
  deviceId: string,
  command: string,
  options: { teamId: string; timeoutMs?: number; deps?: DeviceRuntimeSocketDeps; purpose?: 'exec' | 'terminal' },
): Promise<LocalExecDispatchOutcome> {
  const socket = new DeviceRuntimeSocket(
    { userId, deviceId, teamId: options.teamId, purpose: options.purpose ?? 'exec' },
    options.deps ?? { bus: tunnelBus(), presence: runtimePresenceStore() },
  )

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (outcome: LocalExecDispatchOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      finish({ status: 'timeout' })
    }, options.timeoutMs ?? LOCAL_EXEC_DISPATCH_TIMEOUT_MS)

    socket.addEventListener('open', () => {
      socket.send(command)
    })
    socket.addEventListener('close', () => {
      finish({ status: 'device_disconnected' })
    })
    socket.addEventListener('message', (event) => {
      if (settled) return
      try {
        const result = resultSchema.parse(JSON.parse(String(event.data)))

        finish({ status: 'ok', result })
      } catch (error) {
        settled = true
        clearTimeout(timer)
        socket.close()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    void socket.connect()
  })
}
