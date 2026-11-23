import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'

import { reportedLocalAgent } from './local-runtime-catalog'

import type { LocalRuntimeCatalogDeps } from './local-runtime-catalog'
import type { RuntimeModelCatalog } from './runtime-models'
import type { PreviewRuntimeStatus } from './runtime-status'

const presenceDeps: Pick<LocalRuntimeCatalogDeps, 'getPresence'> = {
  getPresence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
}

/** The computer reports its agent's models when it connects, so none need a conversation first. */
export async function localRuntimeModels(
  runtimeId: string,
  model: string | undefined,
  deps: Pick<LocalRuntimeCatalogDeps, 'getPresence'> = presenceDeps,
): Promise<RuntimeModelCatalog> {
  const ref = parseLocalRuntimeId(runtimeId)
  const agent = ref
    ? reportedLocalAgent((await deps.getPresence(ref.userId, ref.deviceId))?.status, ref)
    : undefined
  const catalog = agent?.models?.failed ? undefined : agent?.models
  const missing = agent?.models?.failed ? 'undiscovered' : 'unreported'

  if (!catalog)
    return { models: [], reason: agent?.cli.loggedIn === false ? 'signed-out' : missing }
  const modelId = model && model !== 'default' ? model : catalog.defaultModel
  // A controls-only report names no model: its entry answers a caller asking for none.
  const split = catalog.controlsOnly && (!model || model === 'default')
  const controls = catalog.controls[modelId] ?? (split ? catalog.controls.default : undefined)

  if (!controls) return { models: catalog.models }

  return { models: catalog.models, controls: { ...(modelId ? { modelId } : {}), ...controls } }
}

/** A local runtime's status comes from its computer's tunnel, not a probe. */
export async function localRuntimeStatus(
  runtimeId: string,
  deps: Pick<LocalRuntimeCatalogDeps, 'getPresence'> = presenceDeps,
): Promise<PreviewRuntimeStatus> {
  const ref = parseLocalRuntimeId(runtimeId)
  const presence = ref ? await deps.getPresence(ref.userId, ref.deviceId) : null
  const agent = ref ? reportedLocalAgent(presence?.status, ref) : undefined
  const online = agent !== undefined
  const signedIn = agent?.cli.loggedIn

  return {
    configured: true,
    selected: true,
    connected: online,
    online,
    attachedConversations: null,
    busyConversations: null,
    ...(agent?.version ? { runtimeAdapterVersion: agent.version } : {}),
    ...(typeof signedIn === 'boolean' ? { authenticated: signedIn } : {}),
    ...(signedIn && agent?.cli.apiKey ? { apiKey: true as const } : {}),
  }
}
