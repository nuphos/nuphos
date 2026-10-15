import { z } from 'zod'

import { AppError } from '@/lib/errors'

import { tunnelBus } from './bus'
import { runtimePresenceStore } from './presence'
import { agentInstanceSchema } from './protocol'
import { DeviceRuntimeSocket } from './socket'

import type { AgentInstance } from './protocol'
import type { DeviceRuntimeSocketDeps } from './socket'

const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), instance: agentInstanceSchema }),
  z.object({ ok: z.literal(false), error: z.string().max(500) }),
])

/** The Box persists its inventory before acknowledging. Retrying an instance id
 * must be idempotent on the host; no second tunnel or cloud credential is used. */
export function createLocalAgentInstance(
  target: { userId: string; actorId: string; deviceId: string; teamId: string },
  instance: AgentInstance,
  options: { deps?: DeviceRuntimeSocketDeps; timeoutMs?: number } = {},
): Promise<AgentInstance> {
  const socket = new DeviceRuntimeSocket(
    { ...target, purpose: 'instances' },
    options.deps ?? { bus: tunnelBus(), presence: runtimePresenceStore() },
  )

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result?: AgentInstance, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const timer = setTimeout(() => {
      finish(
        undefined,
        new AppError(
          504,
          'agent_create_timeout',
          'The Box did not confirm the new agent. Check its agent list before retrying.',
        ),
      )
    }, options.timeoutMs ?? 60_000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ method: 'create', ...instance }))
    })
    socket.addEventListener('close', () => {
      finish(
        undefined,
        new AppError(409, 'runtime_offline', 'The Box disconnected before confirming the agent.'),
      )
    })
    socket.addEventListener('message', (event) => {
      try {
        const response = responseSchema.parse(JSON.parse(String(event.data)))

        if (!response.ok) {
          finish(undefined, new AppError(409, 'agent_create_failed', response.error))

          return
        }
        const result = response.instance

        if (
          !result ||
          result.instanceId !== instance.instanceId ||
          result.provider !== instance.provider
        )
          throw new Error('The Box returned a different agent instance')
        finish(result)
      } catch {
        finish(
          undefined,
          new AppError(
            502,
            'agent_create_invalid_response',
            'The Box returned an invalid agent response.',
          ),
        )
      }
    })
    void socket.connect()
  })
}
