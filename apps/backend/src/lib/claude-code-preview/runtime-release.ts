import { logEvent } from '@/lib/observability'

import { OPENAB_PROVIDERS } from './runtime-provider'

import type { OpenAbProvider } from './runtime-provider'

export const RUNTIME_RELEASES_URL = 'https://github.com/nuphos/nuphos/releases'
const legacyReleasesUrl = 'https://github.com/zeabur/nuphos-runtime/releases'

export const NUPHOS_RUNTIME_REPOSITORY = 'ghcr.io/nuphos/runtime'
export const LEGACY_RUNTIME_REPOSITORY = 'ghcr.io/zeabur/nuphos-runtime'

/** Registry selection follows the trusted release feed, never an arbitrary body URL. */
export function runtimeReleaseRepository(release: RuntimeRelease): string {
  return release.url.startsWith(`${legacyReleasesUrl}/tag/`)
    ? LEGACY_RUNTIME_REPOSITORY
    : NUPHOS_RUNTIME_REPOSITORY
}

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
let cached: { expires: number; result: Promise<Map<OpenAbProvider, RuntimeRelease>> } | undefined
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
  return release.body.includes(
    `${runtimeReleaseRepository(release)}:${release.version}-${provider}`,
  )
}

type GitHubRelease = { tag_name?: string; draft?: boolean; prerelease?: boolean; body?: string }

function parseRelease(release: GitHubRelease, prefix: string, url: string): RuntimeRelease | null {
  if (!release.tag_name?.startsWith(prefix)) return null
  const version = release.tag_name.slice(prefix.length)

  if (release.draft || release.prerelease || !stableRuntimeVersion(version)) return null

  return { version, url: `${url}/tag/${release.tag_name}`, body: release.body ?? '' }
}

/**
 * The newest stable runtime release advertising each provider's image. A release
 * may publish only some providers, so each provider walks back to its own.
 */
async function fetchReleases(): Promise<Map<OpenAbProvider, RuntimeRelease>> {
  // Other components share this repository. Never use its /releases/latest.
  // Follow pages until every provider is found, with a total deadline.
  const signal = AbortSignal.timeout(5_000)
  const headers = { Accept: 'application/vnd.github+json' }
  const found = new Map<OpenAbProvider, RuntimeRelease>()
  const take = (release: RuntimeRelease | null) => {
    if (!release) return
    for (const provider of OPENAB_PROVIDERS)
      if (!found.has(provider) && advertises(release, provider)) found.set(provider, release)
  }

  for (let page = 1; found.size < OPENAB_PROVIDERS.length; page++) {
    const response = await fetch(
      `https://api.github.com/repos/nuphos/nuphos/releases?per_page=100&page=${String(page)}`,
      { headers, signal },
    )

    // A feed that cannot be read is not a feed without releases: no legacy fallback.
    if (!response.ok) return found
    for (const item of (await response.json()) as GitHubRelease[])
      take(parseRelease(item, 'runtime-v', RUNTIME_RELEASES_URL))
    if (!response.headers.get('link')?.includes('rel="next"')) break
  }
  if (found.size) return found

  // The first monorepo image is published only after the migration is merged.
  // Keep existing installations updatable until that cutover succeeds.
  const response = await fetch(
    'https://api.github.com/repos/zeabur/nuphos-runtime/releases/latest',
    { headers, signal },
  )

  if (response.ok)
    take(parseRelease((await response.json()) as GitHubRelease, 'v', legacyReleasesUrl))

  return found
}

/** Public release metadata, shared across cards. Never accept prereleases or arbitrary image URLs. */
export async function latestRuntimeRelease(
  provider: OpenAbProvider,
  refresh = false,
): Promise<RuntimeRelease | null> {
  if (refresh || !cached || cached.expires <= Date.now()) {
    cached = {
      expires: Date.now() + 10 * 60_000,
      result: fetchReleases()
        .then((releases) => {
          // Emit once per metadata refresh, not once per agent poll.
          if (releases.size)
            for (const provider of OPENAB_PROVIDERS)
              if (!releases.has(provider))
                logEvent('warn', 'runtime.release_provider_image_missing', { provider })

          return releases
        })
        .catch(() => new Map<OpenAbProvider, RuntimeRelease>()),
    }
  }
  const fresh = (await cached.result).get(provider)
  const known = lastKnown.get(provider)
  // An equal version is accepted, so re-reading a release whose body was fixed in place
  // takes effect without waiting for a higher version or a restart.
  const follow = fresh && !(known && newerRuntimeVersion(known.version, fresh.version))

  if (follow) lastKnown.set(provider, fresh)

  return follow ? fresh : (known ?? null)
}

let targetLink: { version: string; expires: number; result: Promise<string> } | undefined

/** Resolve older in-flight targets by their actual tag, not the latest release's repository. */
export async function runtimeReleaseUrl(
  version: string,
  release: RuntimeRelease | null,
): Promise<string> {
  if (!stableRuntimeVersion(version)) return RUNTIME_RELEASES_URL
  if (version === release?.version) return release.url
  if (!targetLink || targetLink.version !== version || targetLink.expires <= Date.now()) {
    targetLink = {
      version,
      expires: Date.now() + 10 * 60_000,
      result: fetch(
        `https://api.github.com/repos/nuphos/nuphos/releases/tags/runtime-v${version}`,
        {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(5_000),
        },
      )
        .then((response) => {
          if (response.ok) return `${RUNTIME_RELEASES_URL}/tag/runtime-v${version}`
          if (response.status === 404) return `${legacyReleasesUrl}/tag/v${version}`

          return RUNTIME_RELEASES_URL
        })
        .catch(() => RUNTIME_RELEASES_URL),
    }
  }

  return targetLink.result
}
