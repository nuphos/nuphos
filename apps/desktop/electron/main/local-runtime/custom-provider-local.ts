// This computer's custom providers as the app saves and shows them: one per runtime, the own
// agents' in the account's directory and each added agent's in that runtime's directory.

import path from 'node:path'

import { userDir } from './controller-types.ts'
import {
  checkCustomProvider,
  customProviderLaunch,
  isAgent,
  notSaved,
  readCustomProviders,
  saveCustomProvider,
} from './custom-provider.ts'

import type { LocalRuntimeController } from './controller.ts'
import type { LocalRuntimeControllerDeps, RuntimeProcess } from './controller-types.ts'
import type { CustomProvider, CustomProviderAgent, KeyStore } from './custom-provider.ts'

export function localProviders(
  dataDir: () => string,
  store: KeyStore,
  controller: () => LocalRuntimeController,
) {
  const ownDir = (userId: string) => userDir(dataDir(), userId)
  const instanceDir = (userId: string, instanceId: string) =>
    userDir(path.join(dataDir(), 'instances', instanceId), userId)
  const added = () => controller().state().instances ?? []

  /** Where a provider is saved: the account's own, or an added agent's, named by its id. */
  function dirOf(provider: unknown, instanceId: unknown): string {
    const { userId } = controller().state()

    if (!userId) return notSaved(new Error('Sign in to Nuphos first.'))
    if (!instanceId) return ownDir(userId)
    if (!added().some((agent) => agent.instanceId === instanceId && agent.provider === provider))
      return notSaved(new Error('Runtime instance not found'))

    return instanceDir(userId, instanceId as string)
  }

  return {
    of(userId: string) {
      const instanceProviders: Record<string, CustomProvider> = {}

      for (const { instanceId, provider } of added()) {
        const saved = isAgent(provider)
          ? readCustomProviders(instanceDir(userId, instanceId))[provider]
          : undefined

        if (saved) instanceProviders[instanceId] = saved
      }

      return { customProviders: readCustomProviders(ownDir(userId)), instanceProviders }
    },
    /** Saves a provider, or with null removes it, then restarts the agent it is for. */
    async set(provider: unknown, value: unknown, instanceId?: unknown): Promise<void> {
      const dir = dirOf(provider, instanceId)

      await saveCustomProvider(store, dir, provider, value).catch(notSaved)
      if (!instanceId) {
        await controller().refresh(true, [provider as CustomProviderAgent])

        return
      }
      const restart = controller().instanceRequest({ method: 'restart', instanceId })

      // Saved, it is the sign-in that keeps a pending agent. Removed, the runtime may be left
      // signed out, which its card shows; the removal itself has succeeded.
      await (value === null ? restart.catch(() => {}) : restart)
    },
    /** Tests a provider with one request, before or without saving it. */
    check: async (provider: unknown, value: unknown, instanceId?: unknown) =>
      checkCustomProvider(store, dirOf(provider, instanceId), provider, value).catch(notSaved),
  }
}

/**
 * A CLI probe in which a saved provider stands in for the sign-in, found beside the home.
 * A key that cannot be read leaves the agent signed out, which the card reports as such.
 */
export function withProviderStatus(
  probe: LocalRuntimeControllerDeps['probeCli'],
  store: KeyStore,
): LocalRuntimeControllerDeps['probeCli'] {
  return async (provider, env, agentHome) => {
    const cli = await probe(provider, env, agentHome)
    const saved =
      agentHome && isAgent(provider) ? readCustomProviders(path.dirname(agentHome))[provider] : null

    if (!agentHome || !saved || !cli.installed) return cli
    const readable = await customProviderLaunch(store, provider, agentHome).then(
      () => true,
      () => false,
    )

    return { ...cli, loggedIn: readable, customProvider: new URL(saved.baseUrl).host }
  }
}

/**
 * An openab process that hands the saved provider's key to its agent. Found from the agent's
 * home, so an added agent, whose home is elsewhere, keeps its own sign-in.
 */
export function withProviderKey(process: RuntimeProcess, store: KeyStore): RuntimeProcess {
  return {
    start: async (options) => {
      const custom = await customProviderLaunch(store, options.provider, options.agentHome, options)

      return process.start(custom ? { ...options, secretEnv: custom.env } : options)
    },
    stop: () => process.stop(),
    onExit: (listener) => process.onExit(listener),
  }
}
