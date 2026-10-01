import type { LocalAgentProvider, TunnelPurpose } from './protocol'

export type LocalRuntimeRef = { userId: string; deviceId: string }

/** One agent on one computer: each provider the computer runs is its own agent. */
export type LocalAgentRef = LocalRuntimeRef & { provider: LocalAgentProvider }

const RUNTIME_ID_PREFIX = 'local_'
const CODEX_SUFFIX = 'codex'
const URL_SCHEME = 'nuphos-device:'
const SEGMENT = /^[A-Za-z0-9-]{1,128}$/u

/** A local agent's id in a team's runtime list: owner, device and provider, never a team. */
export function localRuntimeId({ userId, deviceId, provider }: LocalAgentRef): string {
  const id = `${RUNTIME_ID_PREFIX}${userId}_${deviceId}`

  return provider === 'codex' ? `${id}_${CODEX_SUFFIX}` : id
}

export function parseLocalRuntimeId(runtimeId: string): LocalAgentRef | undefined {
  if (!runtimeId.startsWith(RUNTIME_ID_PREFIX)) return undefined
  const [userId, deviceId, suffix, ...rest] = runtimeId.slice(RUNTIME_ID_PREFIX.length).split('_')

  if (rest.length || !userId || !deviceId || !SEGMENT.test(userId) || !SEGMENT.test(deviceId))
    return undefined
  if (suffix !== undefined && suffix !== CODEX_SUFFIX) return undefined

  return { userId, deviceId, provider: suffix === CODEX_SUFFIX ? 'codex' : 'claude-code' }
}

export function isLocalRuntimeId(runtimeId: string | undefined): boolean {
  return runtimeId !== undefined && parseLocalRuntimeId(runtimeId) !== undefined
}

/**
 * The address a conversation is pinned to. It names no host: the backend reaches
 * the runtime only through the tunnel its computer holds open.
 */
export function localRuntimeUrl(ref: LocalAgentRef, teamId: string): string {
  const query = new URLSearchParams({ team: teamId })

  if (ref.provider === 'codex') query.set('provider', 'codex')

  return `${URL_SCHEME}//runtime/${encodeURIComponent(ref.userId)}/${encodeURIComponent(ref.deviceId)}?${query.toString()}`
}

export function isLocalRuntimeUrl(url: string): boolean {
  return url.startsWith(`${URL_SCHEME}//`)
}

export function parseLocalRuntimeUrl(
  url: string,
): (LocalAgentRef & { teamId: string }) | undefined {
  if (!isLocalRuntimeUrl(url)) return undefined
  try {
    const parsed = new URL(url)
    const [userId, deviceId, ...rest] = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
    const teamId = parsed.searchParams.get('team')
    const provider = parsed.searchParams.get('provider') === 'codex' ? 'codex' : 'claude-code'

    if (rest.length || !userId || !deviceId || !teamId) return undefined
    if (!SEGMENT.test(userId) || !SEGMENT.test(deviceId) || !SEGMENT.test(teamId)) return undefined

    return { userId, deviceId, teamId, provider }
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
