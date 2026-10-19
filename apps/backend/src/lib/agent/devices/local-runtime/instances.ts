import { z } from 'zod'

import { AppError } from '@/lib/errors'

import { tunnelBus } from './bus'
import { runtimePresenceStore } from './presence'
import { agentInstanceSchema } from './protocol'
import { DeviceRuntimeSocket } from './socket'

import type { AgentInstance, RemovableAgent } from './protocol'
import type { DeviceRuntimeSocketDeps } from './socket'

const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    instance: agentInstanceSchema.optional(),
    display: z.number().int().min(0).max(255).optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string().max(500) }),
])

type Target = { userId: string; actorId: string; deviceId: string; teamId: string }
type Options = { deps?: DeviceRuntimeSocketDeps; timeoutMs?: number }
type Answer = { instance?: AgentInstance; display?: number }

/** One request over the device's own tunnel; the host answers once and closes. */
function requestInstances(
  target: Target,
  body: { method: 'create' | 'commit' | 'remove' | 'desktop' } & Record<string, unknown>,
  options: Options,
): Promise<Answer> {
  const socket = new DeviceRuntimeSocket(
    { ...target, purpose: 'instances' },
    options.deps ?? { bus: tunnelBus(), presence: runtimePresenceStore() },
  )

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, result: Answer = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      finish(new AppError(504, 'agent_instance_timeout', 'The Box did not answer in time.'))
    }, options.timeoutMs ?? 10_000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(body))
    })
    socket.addEventListener('close', () => {
      finish(new AppError(409, 'runtime_offline', 'The Box disconnected before answering.'))
    })
    socket.addEventListener('message', (event) => {
      try {
        const response = responseSchema.parse(JSON.parse(String(event.data)))

        if (!response.ok) {
          finish(new AppError(409, 'agent_instance_failed', response.error))

          return
        }
        if (
          response.instance &&
          (response.instance.instanceId !== body.instanceId ||
            (body.provider && response.instance.provider !== body.provider))
        )
          throw new Error('The Box returned a different agent instance')
        finish(undefined, response)
      } catch {
        finish(
          new AppError(
            502,
            'agent_instance_invalid_response',
            'The Box returned an invalid answer.',
          ),
        )
      }
    })
    void socket.connect()
  })
}

/** The host records the agent as pending and answers before it starts. Retrying an
 * instance id is idempotent on the host; no second tunnel or cloud credential is used. */
export async function createLocalAgentInstance(
  target: Target,
  instance: AgentInstance,
  options: Options = {},
): Promise<AgentInstance> {
  const { instance: created } = await requestInstances(
    target,
    { method: 'create', ...instance },
    options,
  )

  if (!created)
    throw new AppError(
      502,
      'agent_instance_invalid_response',
      'The Box returned an invalid answer.',
    )

  return created
}

/** Keeps an added agent once its sign-in succeeded; the host checks the login itself. */
export async function commitLocalAgentInstance(
  target: Target,
  instanceId: string,
  options: Options = {},
): Promise<void> {
  await requestInstances(target, { method: 'commit', instanceId }, options)
}

/** Stops an agent and deletes what it stored. Removing a gone agent succeeds. */
export async function removeLocalAgentInstance(
  target: Target,
  agent: RemovableAgent,
  options: Options = {},
): Promise<void> {
  // Stopping a starting agent first waits for it, so allow more than a request.
  await requestInstances(target, { method: 'remove', ...agent }, { timeoutMs: 45_000, ...options })
}

/** Has the Box hold a desktop for the session, its own if it has one; answers the display. */
export async function openLocalDesktop(
  target: Target,
  sessionId: string,
  options: Options = {},
): Promise<number> {
  // Bringing up Xvnc and XFCE takes seconds.
  const { display } = await requestInstances(
    target,
    { method: 'desktop', sessionId },
    { timeoutMs: 30_000, ...options },
  )

  if (display === undefined)
    throw new AppError(
      502,
      'agent_instance_invalid_response',
      'The Box returned an invalid answer.',
    )

  return display
}
