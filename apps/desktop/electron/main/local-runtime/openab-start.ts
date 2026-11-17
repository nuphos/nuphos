import { userDir } from './controller-types.ts'

import type {
  LocalAgentRun,
  LocalRuntimeControllerDeps,
  RuntimeProcess,
} from './controller-types.ts'
import type { OpenabProcessOptions, RunningRuntime } from './openab-process.ts'

/** Starts openab for `run`; null when it did not come up, which the caller retries. */
export async function startOpenab(
  deps: LocalRuntimeControllerDeps,
  process: RuntimeProcess,
  run: LocalAgentRun,
  options: Pick<OpenabProcessOptions, 'bundle' | 'adapter' | 'workspace'>,
): Promise<RunningRuntime | null> {
  const launchedAt = Date.now()

  try {
    const runtime = await process.start({
      ...options,
      provider: run.provider,
      nodeExecPath: deps.nodeExecPath,
      cliPath: run.cliPath,
      agentHome: run.agentHome,
      openabHome: userDir(deps.dataDir(), run.userId, `openab-home-${run.provider}`),
      logDir: userDir(deps.dataDir(), run.userId, run.provider),
      env: run.env,
    })

    deps.log?.('local agent: openab up', { provider: run.provider, ms: Date.now() - launchedAt })

    return runtime
  } catch (error) {
    deps.log?.('local agent: openab failed', { provider: run.provider, error: String(error) })

    return null
  }
}
