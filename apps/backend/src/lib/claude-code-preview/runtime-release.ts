import type { OpenAbProvider } from './runtime-provider'

import { logEvent } from '@/lib/observability'

export const RUNTIME_RELEASES_URL = 'https://github.com/zeabur/nuphos-runtime/releases'
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

/** Public release metadata, shared across cards. Never accept prereleases or arbitrary image URLs. */
export async function latestRuntimeRelease(
  provider: OpenAbProvider,
  refresh = false,
): Promise<RuntimeRelease | null> {
  if (refresh || !cached || cached.expires <= Date.now()) {
    cached = {
      expires: Date.now() + 10 * 60_000,
      result: fetch('https://api.github.com/repos/zeabur/nuphos-runtime/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(5_000),
      })
        .then(async (response) => {
          if (!response.ok) return null
          const release = (await response.json()) as {
            tag_name?: string
            draft?: boolean
            prerelease?: boolean
            body?: string
          }
          const version = release.tag_name?.replace(/^v/, '')

          if (release.draft || release.prerelease || !stableRuntimeVersion(version)) return null

          // Emit once per metadata refresh, not once per agent poll.
          for (const provider of ['claude-code', 'codex']) {
            if (!release.body?.includes(`${repository}:${version}-${provider}`))
              logEvent('warn', 'runtime.release_provider_image_missing', { version, provider })
          }

          return {
            version,
            url: `${RUNTIME_RELEASES_URL}/tag/v${version}`,
            body: release.body ?? '',
          }
        })
        .catch(() => null),
    }
  }
  const release = await cached.result

  // A provider-only release must not advertise an image it did not publish.
  return release?.body.includes(`${repository}:${release.version}-${provider}`) ? release : null
}
