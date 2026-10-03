import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'
import { USAGE_SAMPLE_MS, USAGE_SIGN_IN_FLOOR_MS } from './controller-types.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { Agent } from './controller-types.ts'

type Attempt = { at: number; inFlight: boolean }

/** Reads what is left of this computer's provider accounts on its own schedule,
 *  never in the way of an agent starting and never clearing a reading it
 *  already holds: a figure a few minutes old beats none, and the hold that
 *  protects the provider lives in Nuphos.
 *
 *  Every read goes through one floor, because the call sites cannot be trusted
 *  to pace themselves — a crash loop restarts an agent every second or two, and
 *  asking the provider that often is what stuck the hosted accounts on 429 in
 *  the first place. A sign-in is the one event that earns a shorter floor: the
 *  credential it just wrote is the whole point of reading again. */
export function createUsageSampler(
  agents: Record<LocalAgentProvider, Agent>,
  deps: {
    userEnv: () => Promise<NodeJS.ProcessEnv>
    readUsage: (provider: LocalAgentProvider, env: NodeJS.ProcessEnv) => Promise<unknown>
  },
  onReading: () => void,
  now: () => number = Date.now,
): {
  sample: (provider: LocalAgentProvider, signedInJustChanged?: boolean) => Promise<void>
  stop: () => void
} {
  let timer: ReturnType<typeof setInterval> | undefined
  const attempts = new Map<LocalAgentProvider, Attempt>()
  const sample = async (
    provider: LocalAgentProvider,
    signedInJustChanged = false,
  ): Promise<void> => {
    const agent = agents[provider]
    const attempt = attempts.get(provider) ?? { at: 0, inFlight: false }
    const floor = signedInJustChanged ? USAGE_SIGN_IN_FLOOR_MS : USAGE_SAMPLE_MS

    // The first read arms the timer: nothing samples a computer that is not
    // running an agent yet.
    timer ??= setInterval(() => {
      for (const p of LOCAL_AGENT_PROVIDERS) void sample(p)
    }, USAGE_SAMPLE_MS).unref()
    if (attempt.inFlight || now() - attempt.at < floor) return
    if (!agent.cli?.installed || agent.cli.loggedIn === false) return
    // The agent this answer belongs to. `stopAgent` bumps it, so a restart or a
    // signed-out user makes a late reply land on a generation that has moved on
    // — the records are mutated in place, so identity alone proves nothing.
    const generation = agent.generation

    // Stamped once, when the read starts. Re-stamping it on completion pushed
    // the next tick past the floor by however long the read took, which turned
    // a ten-minute cadence into twenty.
    const startedAt = now()

    attempts.set(provider, { at: startedAt, inFlight: true })
    const usage = await deps
      .readUsage(provider, await deps.userEnv())
      .catch(() => undefined)
      .finally(() => attempts.set(provider, { at: startedAt, inFlight: false }))

    if (usage === undefined || agent.generation !== generation) return
    agent.usage = usage
    agent.usageAt = new Date().toISOString()
    onReading()
  }

  return {
    sample,
    stop: () => {
      if (timer) clearInterval(timer)
      timer = undefined
      attempts.clear()
    },
  }
}
