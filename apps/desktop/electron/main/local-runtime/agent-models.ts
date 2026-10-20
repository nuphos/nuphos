import type { Agent, LocalAgentRun, LocalRuntimeControllerDeps } from './controller-types.ts'

/** Reads the models a started agent offers; a run that has since been replaced keeps none. */
export function discoverModels(
  deps: LocalRuntimeControllerDeps,
  run: LocalAgentRun,
  agent: Agent,
  workspace: string,
  sendStatus: () => void,
): void {
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
      },
    )
}
