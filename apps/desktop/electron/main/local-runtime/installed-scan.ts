import { locateAgentCli } from './agent-cli-find.ts'
import { LOCAL_AGENT_PROVIDERS } from './providers.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

/**
 * Which runtimes' command-line tools are on this computer, and nothing more: it
 * only looks for the executables. It never runs them, reads a login, starts a
 * runtime or registers this computer, so a development build can use it too
 * without touching the installed app's connection to Nuphos Cloud.
 */
export async function findInstalledAgents(env: NodeJS.ProcessEnv): Promise<LocalAgentProvider[]> {
  const found = await Promise.all(
    LOCAL_AGENT_PROVIDERS.map(async (provider) =>
      (await locateAgentCli(provider, env).catch(() => null)) ? provider : null,
    ),
  )

  return found.filter((provider): provider is LocalAgentProvider => provider !== null)
}
