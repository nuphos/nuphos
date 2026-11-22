import type { Agent, LocalAgentRun, LocalRuntimeControllerDeps } from './controller-types.ts'

/** Waits between failed probes; each probe starts the agent's CLI, so a lasting failure backs off. */
export const MODEL_RETRY_MS = [60_000, 120_000, 300_000, 600_000]
/** A good list is read again this often while the agent runs. */
export const MODEL_REFRESH_MS = 30 * 60_000
/** A signed-out CLI is checked for a sign-in this often before its models are read. */
export const MODEL_SIGNED_OUT_MS = 60_000
/** An opened model picker reads again at most this often. */
export const MODEL_ON_DEMAND_MS = 60_000
/**
 * How long an agent waits before its first read, when it is not at once. A Hermes read starts
 * a gateway daemon of its own, and a conversation's daemon does not start until it is ready:
 * read at once, it holds back the conversation started just after the agent was added.
 */
export const MODEL_FIRST_READ_MS: Partial<Record<string, number>> = { hermes: 60_000 }

type Reader = { live: () => boolean; read: () => Promise<boolean | undefined> }

const readers = new Set<Reader>()

/**
 * Reads the models a started agent offers, and keeps reading while it runs:
 * the provider's list changes under a running agent (a plan change, a new
 * model, a CLI update), and one failed or partial read would otherwise stand
 * until the agent restarts. A run that has since been replaced keeps none,
 * and a restarted process reads for itself.
 */
export function discoverModels(
  deps: LocalRuntimeControllerDeps,
  run: LocalAgentRun,
  agent: Agent,
  workspace: string,
  sendStatus: () => void,
): void {
  const runtime = agent.runtime
  const live = () => run.current() && agent.runtime === runtime
  let inFlight: Promise<boolean | undefined> | undefined
  let readAt = 0
  // Reads failed in a row; an adapter that keeps failing is not started again on demand.
  let failedReads = 0
  // Whether the list changed; undefined when the read failed or the run is gone.
  const read = () => {
    readAt = Date.now()
    inFlight ??= deps
      .probeModels({
        provider: run.provider,
        workspace,
        env: run.env,
        cliPath: run.cliPath,
        agentHome: run.agentHome,
      })
      .then(
        (models) => {
          if (!live()) return undefined
          failedReads = 0
          const changed = JSON.stringify(models) !== JSON.stringify(agent.models)

          agent.models = models
          if (changed) sendStatus()

          return changed
        },
        (error: unknown) => {
          if (!live()) return undefined
          failedReads++
          deps.log?.('local agent: model discovery failed', {
            provider: run.provider,
            error: String(error),
          })
          if (!agent.models) {
            agent.models = { models: [], defaultModel: '', controls: {}, failed: true }
            sendStatus()
          }

          return undefined
        },
      )
      .finally(() => {
        inFlight = undefined
      })

    return inFlight
  }
  // Each read starts the CLI, and one signed out cannot list models: wait for its sign-in.
  const signedOut = () => agent.cli?.installed === true && agent.cli.loggedIn === false
  const cycle = (failures: number) => {
    if (signedOut()) {
      setTimeout(() => {
        if (live()) cycle(failures)
      }, MODEL_SIGNED_OUT_MS).unref()

      return
    }
    void read().then((changed) => {
      if (!live()) return
      // The last good list stays reported while a failed read is tried again.
      const delay =
        changed === undefined
          ? MODEL_RETRY_MS[Math.min(failures, MODEL_RETRY_MS.length - 1)]
          : MODEL_REFRESH_MS

      // Never keeps the app (or a test run) alive on its own.
      setTimeout(() => {
        if (live()) cycle(changed === undefined ? failures + 1 : 0)
      }, delay).unref()
    })
  }

  // An opened picker reads at most once a minute, and after failures no sooner than a retry would.
  const onDemandGap = () =>
    failedReads
      ? MODEL_RETRY_MS[Math.min(failedReads - 1, MODEL_RETRY_MS.length - 1)]
      : MODEL_ON_DEMAND_MS

  readers.add({
    live,
    read: () =>
      inFlight ??
      (signedOut() || Date.now() - readAt < onDemandGap() ? Promise.resolve(false) : read()),
  })
  const first = MODEL_FIRST_READ_MS[run.provider]

  if (first)
    setTimeout(() => {
      if (live()) cycle(0)
    }, first).unref()
  else cycle(0)
}

/**
 * Reads every running agent's models now, as an opened model picker asks, so a
 * list that changed since the last read shows without waiting for the next
 * one.
 */
export async function refreshRunningModels(): Promise<void> {
  for (const reader of readers) if (!reader.live()) readers.delete(reader)
  await Promise.all([...readers].map((reader) => reader.read()))
}
