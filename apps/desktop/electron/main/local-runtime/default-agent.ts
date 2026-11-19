import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'
import { deleteDefaultLogin } from './agent-home.ts'
import { userDir } from './controller-types.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

/** Checks the computer's own agent of a provider again; `restart` also restarts it. */
export type RefreshDefault = (provider: LocalAgentProvider, restart: boolean) => Promise<unknown>

/**
 * Signs a Box's default agent out for good: deletes its login, then restarts it signed
 * out, which keeps it unlisted, also after a restart. A person's computer never does:
 * there these logins are that person's own CLI logins.
 */
export async function removeDefaultAgent(
  deps: LocalRuntimeControllerDeps,
  userId: string,
  provider: unknown,
  refresh: RefreshDefault | undefined,
): Promise<unknown> {
  if (!deps.ownsMachine || !refresh)
    throw new Error('Only a cloud computer removes its default runtimes')
  if (!LOCAL_AGENT_PROVIDERS.includes(provider as LocalAgentProvider))
    throw new Error('Invalid runtime provider')
  if (provider === 'antigravity')
    throw new Error(
      'Sign out with the official Antigravity CLI; this may sign out other local Antigravity apps',
    )
  deleteDefaultLogin(
    provider as LocalAgentProvider,
    userDir(deps.dataDir(), userId),
    await deps.userEnv(),
  )
  await refresh(provider as LocalAgentProvider, true)

  return {}
}

/** Checks the computer's own agent again once its sign-in finished, so it is listed signed
 *  in now rather than at the next check. */
async function commitDefaultAgent(provider: unknown, refresh: RefreshDefault | undefined) {
  if (!LOCAL_AGENT_PROVIDERS.includes(provider as LocalAgentProvider))
    throw new Error('Invalid runtime provider')
  await refresh?.(provider as LocalAgentProvider, false)

  return {}
}

/** A request about the computer's own agent of a provider, which names it by its provider. */
export function defaultAgentRequest(
  deps: LocalRuntimeControllerDeps,
  userId: string,
  method: 'remove' | 'commit',
  provider: unknown,
  refresh: RefreshDefault | undefined,
): Promise<unknown> {
  return method === 'remove'
    ? removeDefaultAgent(deps, userId, provider, refresh)
    : commitDefaultAgent(provider, refresh)
}
