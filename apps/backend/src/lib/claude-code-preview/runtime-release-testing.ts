// Test-only: stands in for the nuphos-runtime GitHub Releases feed and the ghcr manifests
// behind it, so a test can say which release is the latest one — and which tags the
// registry actually serves — without reaching the network.

import { createHash } from 'node:crypto'

import { resetRuntimeImageDigests } from './runtime-image'
import { OPENAB_PROVIDERS } from './runtime-provider'
import {
  latestRuntimeRelease,
  LEGACY_RUNTIME_REPOSITORY,
  NUPHOS_RUNTIME_REPOSITORY,
  resetRuntimeReleaseCache,
} from './runtime-release'

import type { OpenAbProvider } from './runtime-provider'

const realFetch = globalThis.fetch

function digestOf(tag: string): string {
  return `sha256:${createHash('sha256').update(tag).digest('hex')}`
}

/** What `managedRuntimeImage()` resolves to for a version the registry serves. */
export function publishedRuntimeImage(
  version: string,
  provider: OpenAbProvider,
  legacy = false,
): string {
  const tag = `${version}-${provider}`

  return `${legacy ? LEGACY_RUNTIME_REPOSITORY : NUPHOS_RUNTIME_REPOSITORY}:${tag}@${digestOf(tag)}`
}

/**
 * What the stubbed feed serves. `version` is the latest release, omitted for an outage;
 * `published` names the versions the registry serves manifests for, defaulting to
 * `version` alone; `advertises` names the providers the release body mentions an image
 * for, defaulting to both.
 */
export type RuntimeFeed = {
  version?: string
  published?: string[]
  legacyPublished?: string[]
  legacy?: boolean
  advertises?: OpenAbProvider[]
}

let requests = 0

/** How many requests the stub has served since it was last installed. */
export function runtimeFeedRequests(): number {
  return requests
}

function feed({
  version,
  published,
  legacyPublished = [],
  legacy = false,
  advertises,
}: RuntimeFeed) {
  const tags = new Set(
    (published ?? (version ? [version] : [])).flatMap((value) =>
      OPENAB_PROVIDERS.map((provider) => `${value}-${provider}`),
    ),
  )
  const legacyTags = new Set(
    legacyPublished.flatMap((value) => OPENAB_PROVIDERS.map((provider) => `${value}-${provider}`)),
  )
  const repository = legacy ? LEGACY_RUNTIME_REPOSITORY : NUPHOS_RUNTIME_REPOSITORY
  const body = (advertises ?? OPENAB_PROVIDERS)
    .map((provider) => `${repository}:${version}-${provider}`)
    .join('\n')

  return (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString()
    const manifest = /\/v2\/.+\/manifests\/(.+)$/.exec(url)

    requests += 1
    if (url.includes('/token?')) return Promise.resolve(Response.json({ token: 'anonymous' }))
    if (manifest) {
      const tag = manifest[1]!

      return Promise.resolve(
        (url.includes('/v2/zeabur/nuphos-runtime/') ? legacyTags : tags).has(tag)
          ? new Response(null, { headers: { 'docker-content-digest': digestOf(tag) } })
          : new Response(null, { status: 404 }),
      )
    }

    if (legacy && url.includes('/repos/nuphos/nuphos/releases?'))
      return Promise.resolve(Response.json([]))
    if (legacy && version && url.includes('/releases/latest')) {
      return Promise.resolve(Response.json({ tag_name: `v${version}`, body }))
    }

    return Promise.resolve(
      version && url.includes('/repos/nuphos/nuphos/releases?')
        ? Response.json([{ tag_name: `runtime-v${version}`, body }])
        : new Response('', { status: 500 }),
    )
  }
}

function serve(spec: RuntimeFeed): void {
  requests = 0
  globalThis.fetch = feed(spec) as unknown as typeof globalThis.fetch
}

/** The whole fleet state: a resolver that has seen nothing else, now serving `spec`. */
export async function publishRuntimeRelease(spec: RuntimeFeed = {}): Promise<void> {
  resetRuntimeReleaseCache()
  resetRuntimeImageDigests()
  serve(spec)
  await latestRuntimeRelease('claude-code')
}

/** A later feed, served to a resolver that already saw a release — an outage, or a rollback. */
export async function refreshRuntimeRelease(spec: RuntimeFeed = {}): Promise<void> {
  serve(spec)
  await latestRuntimeRelease('claude-code', true)
}

export function restoreRuntimeReleases(): void {
  resetRuntimeReleaseCache()
  resetRuntimeImageDigests()
  globalThis.fetch = realFetch
}
