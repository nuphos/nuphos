import type { OpenAbProvider } from './runtime-provider'

import { logEvent } from '@/lib/observability'

export const RUNTIME_RELEASES_URL = 'https://github.com/zeabur/nuphos-runtime/releases'
export const NUPHOS_RUNTIME_REPOSITORY = 'ghcr.io/zeabur/nuphos-runtime'

export function stableRuntimeVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
}

export function newerRuntimeVersion(candidate: string, current: string): boolean {
  if (!stableRuntimeVersion(candidate) || !stableRuntimeVersion(current)) return false
  const a = candidate.split('.').map(Number)
  const b = current.split('.').map(Number)

  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)

  return false
}

export type RuntimeRelease = { version: string; url: string; body: string }
let cached: { expires: number; result: Promise<RuntimeRelease | null> } | undefined
/**
 * The release each provider's fleet follows. Managed agents resolve their image from it, so
 * it only ever moves to a release that advertises that provider's image, and never
 * backwards — one unreachable GitHub, one body edited to drop an image line, and one
 * deleted or re-tagged release all leave the fleet where it is.
 */
const lastKnown = new Map<OpenAbProvider, RuntimeRelease>()

/** Test-only: the two module singletons above outlive a stubbed `fetch`. */
export function resetRuntimeReleaseCache(): void {
  cached = undefined
  lastKnown.clear()
}

/** A provider-only release must not advertise an image it did not publish. */
function advertises(release: RuntimeRelease, provider: OpenAbProvider): boolean {
  return release.body.includes(`${NUPHOS_RUNTIME_REPOSITORY}:${release.version}-${provider}`)
}

async function fetchLatestRelease(): Promise<RuntimeRelease | null> {
  const response = await fetch(
    'https://api.github.com/repos/zeabur/nuphos-runtime/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5_000) },
  )

  if (!response.ok) return null
  const release = (await response.json()) as {
    tag_name?: string
    draft?: boolean
    prerelease?: boolean
    body?: string
  }
  const version = release.tag_name?.replace(/^v/, '')

  if (release.draft || release.prerelease || !stableRuntimeVersion(version)) return null
  const body = release.body ?? ''

  // Emit once per metadata refresh, not once per agent poll.
  for (const provider of ['claude-code', 'codex']) {
    if (!body.includes(`${NUPHOS_RUNTIME_REPOSITORY}:${version}-${provider}`))
      logEvent('warn', 'runtime.release_provider_image_missing', { version, provider })
  }

  return { version, url: `${RUNTIME_RELEASES_URL}/tag/v${version}`, body }
}

/** Public release metadata, shared across cards. Never accept prereleases or arbitrary image URLs. */
export async function latestRuntimeRelease(
  provider: OpenAbProvider,
  refresh = false,
): Promise<RuntimeRelease | null> {
  if (refresh || !cached || cached.expires <= Date.now()) {
    cached = {
      expires: Date.now() + 10 * 60_000,
      result: fetchLatestRelease().catch(() => null),
    }
  }
  const fresh = await cached.result
  const known = lastKnown.get(provider)
  // An equal version is accepted, so re-reading a release whose body was fixed in place
  // takes effect without waiting for a higher version or a restart.
  const follow =
    fresh &&
    advertises(fresh, provider) &&
    !(known && newerRuntimeVersion(known.version, fresh.version))

  if (follow) lastKnown.set(provider, fresh)

  return follow ? fresh : (known ?? null)
}
