import type { OpenAbProvider } from './runtime-provider'

import { logEvent } from '@/lib/observability'

export const RUNTIME_RELEASES_URL = 'https://github.com/nuphos/nuphos/releases'
const legacyReleasesUrl = 'https://github.com/zeabur/nuphos-runtime/releases'
const repository = 'ghcr.io/zeabur/nuphos-runtime'

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

type GitHubRelease = { tag_name?: string; draft?: boolean; prerelease?: boolean; body?: string }

function parseRelease(release: GitHubRelease, prefix: string, url: string): RuntimeRelease | null {
  if (!release.tag_name?.startsWith(prefix)) return null
  const version = release.tag_name.slice(prefix.length)

  if (release.draft || release.prerelease || !stableRuntimeVersion(version)) return null

  return { version, url: `${url}/tag/${release.tag_name}`, body: release.body ?? '' }
}

async function fetchRelease(): Promise<RuntimeRelease | null> {
  // Other components share this repository. Never use its /releases/latest.
  // Follow pages until a stable runtime release is found, with a total deadline.
  const signal = AbortSignal.timeout(5_000)
  const headers = { Accept: 'application/vnd.github+json' }

  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/nuphos/nuphos/releases?per_page=100&page=${String(page)}`,
      { headers, signal },
    )

    if (!response.ok) return null
    const releases = (await response.json()) as GitHubRelease[]
    const release = releases
      .map((item) => parseRelease(item, 'runtime-v', RUNTIME_RELEASES_URL))
      .find((item) => item !== null)

    if (release) return release
    if (!response.headers.get('link')?.includes('rel="next"')) break
  }

  // The first monorepo image is published only after the migration is merged.
  // Keep existing installations updatable until that cutover succeeds.
  const response = await fetch(
    'https://api.github.com/repos/zeabur/nuphos-runtime/releases/latest',
    {
      headers,
      signal,
    },
  )

  if (!response.ok) return null

  return parseRelease((await response.json()) as GitHubRelease, 'v', legacyReleasesUrl)
}

/** Public release metadata, shared across cards. Never accept prereleases or arbitrary image URLs. */
export async function latestRuntimeRelease(
  provider: OpenAbProvider,
  refresh = false,
): Promise<RuntimeRelease | null> {
  if (refresh || !cached || cached.expires <= Date.now()) {
    cached = {
      expires: Date.now() + 10 * 60_000,
      result: fetchRelease()
        .then((release) => {
          if (!release) return null
          // Emit once per metadata refresh, not once per agent poll.
          for (const provider of ['claude-code', 'codex']) {
            if (!release.body.includes(`${repository}:${release.version}-${provider}`))
              logEvent('warn', 'runtime.release_provider_image_missing', {
                version: release.version,
                provider,
              })
          }

          return release
        })
        .catch(() => null),
    }
  }
  const release = await cached.result

  // A provider-only release must not advertise an image it did not publish.
  return release?.body.includes(`${repository}:${release.version}-${provider}`) ? release : null
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
