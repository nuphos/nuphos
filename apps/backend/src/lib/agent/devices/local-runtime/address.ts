import { LOCAL_AGENT_PROVIDERS } from './protocol'

import type { LocalAgentProvider, TunnelPurpose } from './protocol'

export type LocalRuntimeRef = { userId: string; deviceId: string }

/** One agent on one computer: each provider the computer runs is its own agent. */
export type LocalAgentRef = LocalRuntimeRef & { provider: LocalAgentProvider; instanceId?: string }

const RUNTIME_ID_PREFIX = 'local_'
// Claude Code's ids predate the others and carry no provider.
const DEFAULT_PROVIDER = 'claude-code'
const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const URL_SCHEME = 'nuphos-device:'
const SEGMENT = /^[A-Za-z0-9-]{1,128}$/u

/** A local agent's id in a team's runtime list: owner, device and provider, never a team. */
export function localRuntimeId({ userId, deviceId, provider, instanceId }: LocalAgentRef): string {
  const id = `${RUNTIME_ID_PREFIX}${userId}_${deviceId}`

  if (instanceId) {
    if (!INSTANCE_ID.test(instanceId)) throw new Error('Invalid agent instance id')

    return `${id}_${provider}_${instanceId}`
  }

  return provider === DEFAULT_PROVIDER ? id : `${id}_${provider}`
}

function localProvider(value: string | undefined): LocalAgentProvider | undefined {
  return LOCAL_AGENT_PROVIDERS.find((provider) => provider === value)
}

export function parseLocalRuntimeId(runtimeId: string): LocalAgentRef | undefined {
  if (!runtimeId.startsWith(RUNTIME_ID_PREFIX)) return undefined
  const [userId, deviceId, suffix, instanceId, ...rest] = runtimeId
    .slice(RUNTIME_ID_PREFIX.length)
    .split('_')

  if (rest.length || !userId || !deviceId || !SEGMENT.test(userId) || !SEGMENT.test(deviceId))
    return undefined
  if (instanceId !== undefined) {
    const provider = localProvider(suffix)

    if (!INSTANCE_ID.test(instanceId) || !provider) return undefined

    return { userId, deviceId, provider, instanceId }
  }
  if (suffix === undefined) return { userId, deviceId, provider: DEFAULT_PROVIDER }
  const provider = localProvider(suffix)

  return provider && provider !== DEFAULT_PROVIDER ? { userId, deviceId, provider } : undefined
}

export function isLocalRuntimeId(runtimeId: string | undefined): boolean {
  return runtimeId !== undefined && parseLocalRuntimeId(runtimeId) !== undefined
}

/**
 * The address a conversation is pinned to. It names no host: the backend reaches
 * the runtime only through the tunnel its computer holds open.
 */
export function localRuntimeUrl(ref: LocalAgentRef, teamId: string, actorId = ref.userId): string {
  const query = new URLSearchParams({ team: teamId })

  // Only someone other than the owner (a Box's member) adds an actor; owners' URLs stay as they were.
  if (actorId !== ref.userId) query.set('actor', actorId)

  if (ref.provider !== DEFAULT_PROVIDER) query.set('provider', ref.provider)
  if (ref.instanceId) query.set('instance', ref.instanceId)

  return `${URL_SCHEME}//runtime/${encodeURIComponent(ref.userId)}/${encodeURIComponent(ref.deviceId)}?${query.toString()}`
}

export function isLocalRuntimeUrl(url: string): boolean {
  return url.startsWith(`${URL_SCHEME}//`)
}

export function parseLocalRuntimeUrl(
  url: string,
): (LocalAgentRef & { teamId: string; actorId: string }) | undefined {
  if (!isLocalRuntimeUrl(url)) return undefined
  try {
    const parsed = new URL(url)
    const [userId, deviceId, ...rest] = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
    const teamId = parsed.searchParams.get('team')
    const actorId = parsed.searchParams.get('actor') ?? userId
    const rawProvider = parsed.searchParams.get('provider')

    const provider = rawProvider === null ? DEFAULT_PROVIDER : localProvider(rawProvider)

    if (!provider) return undefined
    const instanceId = parsed.searchParams.get('instance')

    if (instanceId !== null && !INSTANCE_ID.test(instanceId)) return undefined

    if (rest.length || !userId || !deviceId || !teamId || !actorId) return undefined
    if (![userId, deviceId, teamId, actorId].every((part) => SEGMENT.test(part))) return undefined

    return { userId, deviceId, teamId, actorId, provider, ...(instanceId ? { instanceId } : {}) }
  } catch {
    return undefined
  }
}

const BEARER_PREFIX = 'openab.bearer.'

/**
 * A local endpoint carries its purpose where a remote one carries its key: the
 * computer holds the runtime's real keys and picks one per stream.
 */
export function purposeFromProtocols(protocols: string[]): TunnelPurpose {
  const bearer = protocols.find((protocol) => protocol.startsWith(BEARER_PREFIX))

  return bearer?.slice(BEARER_PREFIX.length) === 'control' ? 'control' : 'transport'
}
