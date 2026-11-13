import type { Agent, LocalAgentRun, LocalRuntimeControllerDeps } from './controller-types.ts'

/** Waits between failed probes; each probe starts the agent's CLI, so a lasting failure backs off. */
const RETRY_MS = [60_000, 120_000, 300_000, 600_000]

/**
 * Reads the models a started agent offers; a run that has since been replaced keeps none.
 * A failed probe (a busy computer, a sign-in refresh) is tried again: until one succeeds,
 * every conversation on the agent has no models to show or pick.
 */
export function discoverModels(
  deps: LocalRuntimeControllerDeps,
  run: LocalAgentRun,
  agent: Agent,
  workspace: string,
  sendStatus: () => void,
  attempt = 0,
): void {
  const runtime = agent.runtime

  void deps
    .probeModels({
      provider: run.provider,
      workspace,
      env: run.env,
      cliPath: run.cliPath,
      agentHome: run.agentHome,
    })
    .then(
      (models) => {
        if (!run.current()) return
        agent.models = models
        sendStatus()
      },
      (error: unknown) => {
        deps.log?.('local agent: model discovery failed', {
          provider: run.provider,
          error: String(error),
        })
        setTimeout(
          () => {
            // A restarted process probes for itself.
            if (run.current() && agent.runtime === runtime)
              discoverModels(deps, run, agent, workspace, sendStatus, attempt + 1)
          },
          RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)],
        ).unref?.()
      },
    )
}
