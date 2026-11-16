import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'
import { ANTIGRAVITY_SIGN_OUT, deleteDefaultCredentials } from './agent-credentials.ts'
import { deleteDefaultLogin } from './agent-home.ts'
import { prepareHomeFor, userDir } from './controller-types.ts'
import { agentHomeName } from './providers.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

/** Checks the computer's own agent of a provider again; `restart` also restarts it. */
export type RefreshDefault = (provider: LocalAgentProvider, restart: boolean) => Promise<unknown>
/** Stops the computer's own agent of a provider until the next refresh starts it. */
export type StopDefault = (provider: LocalAgentProvider) => Promise<void>
export type DefaultAgentControl = { refreshDefault?: RefreshDefault; stopDefault?: StopDefault }

/** A default agent whose login Nuphos may delete: never Antigravity's shared OS sign-in. */
function deletableProvider(provider: unknown): LocalAgentProvider {
  if (!LOCAL_AGENT_PROVIDERS.includes(provider as LocalAgentProvider))
    throw new Error('Invalid runtime provider')
  if (provider === 'antigravity') throw new Error(ANTIGRAVITY_SIGN_OUT)

  return provider as LocalAgentProvider
}

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
  const agent = deletableProvider(provider)

  deleteDefaultLogin(agent, userDir(deps.dataDir(), userId), await deps.userEnv())
  await refresh(agent, true)

  return {}
}

/**
 * Signs a Box's default agent out but keeps it: stops it, deletes every credential it holds,
 * then starts it again signed out. Its settings, sessions and workspace stay. As with removal,
 * a person's computer never does: these are that person's own CLI logins.
 */
async function resetDefaultAgent(
  deps: LocalRuntimeControllerDeps,
  userId: string,
  provider: unknown,
  refresh: RefreshDefault | undefined,
  stop: StopDefault | undefined,
): Promise<unknown> {
  if (!deps.ownsMachine || !refresh || !stop)
    throw new Error('Only a cloud computer resets its default runtimes')
  const agent = deletableProvider(provider)
  const env = await deps.userEnv()

  await stop(agent)
  deleteDefaultCredentials(
    agent,
    prepareHomeFor(deps, agent, userId, env) ??
      userDir(deps.dataDir(), userId, agentHomeName(agent)),
    env,
  )
  await refresh(agent, false)

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
  method: 'remove' | 'commit' | 'reset',
  provider: unknown,
  { refreshDefault, stopDefault }: DefaultAgentControl,
): Promise<unknown> {
  if (method === 'reset')
    return resetDefaultAgent(deps, userId, provider, refreshDefault, stopDefault)

  return method === 'remove'
    ? removeDefaultAgent(deps, userId, provider, refreshDefault)
    : commitDefaultAgent(provider, refreshDefault)
}
