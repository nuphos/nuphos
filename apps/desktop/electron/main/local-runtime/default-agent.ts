import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'
import { deleteDefaultLogin } from './agent-home.ts'
import { userDir } from './controller-types.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

/**
 * Signs a Box's default agent out for good: deletes its login, then restarts it signed
 * out, which keeps it unlisted, also after a restart. A person's computer never does:
 * there these logins are that person's own CLI logins.
 */
export async function removeDefaultAgent(
  deps: LocalRuntimeControllerDeps,
  userId: string,
  provider: unknown,
  restart: ((provider: LocalAgentProvider) => Promise<unknown>) | undefined,
): Promise<unknown> {
  if (!deps.ownsMachine || !restart)
    throw new Error('Only a cloud computer removes its default runtimes')
  if (!LOCAL_AGENT_PROVIDERS.includes(provider as LocalAgentProvider))
    throw new Error('Invalid runtime provider')
  deleteDefaultLogin(
    provider as LocalAgentProvider,
    userDir(deps.dataDir(), userId),
    await deps.userEnv(),
  )
  await restart(provider as LocalAgentProvider)

  return {}
}
