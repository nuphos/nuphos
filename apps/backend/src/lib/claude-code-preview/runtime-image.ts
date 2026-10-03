import {
  latestRuntimeRelease,
  NUPHOS_RUNTIME_REPOSITORY,
  stableRuntimeVersion,
} from './runtime-release'

import type { OpenAbProvider } from './runtime-provider'

import { logEvent } from '@/lib/observability'

const [REGISTRY, ...REPOSITORY] = NUPHOS_RUNTIME_REPOSITORY.split('/')
const REPOSITORY_PATH = REPOSITORY.join('/')
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

/**
 * Resolved digests, keyed by tag. A published tag's digest does not change, so a hit is
 * kept for this process's life — which also means a registry outage cannot un-resolve an
 * image the fleet is already running. A miss expires instead, so a tag published later is
 * still picked up.
 */
const digests = new Map<string, { expires: number; result: Promise<string | undefined> }>()
const MISS_TTL_MS = 60_000

/** Test-only: the map above outlives a stubbed `fetch`. */
export function resetRuntimeImageDigests(): void {
  digests.clear()
}

/** The digest the registry serves for `tag`, or `undefined` when it serves none. */
async function lookUpDigest(tag: string): Promise<string | undefined> {
  // The package is public, so the pull token is handed to anyone who asks.
  const auth = await fetch(
    `https://${REGISTRY}/token?scope=repository:${REPOSITORY_PATH}:pull&service=${REGISTRY}`,
    { signal: AbortSignal.timeout(5_000) },
  )

  if (!auth.ok) return undefined
  const { token } = (await auth.json()) as { token?: string }

  if (!token) return undefined
  const manifest = await fetch(`https://${REGISTRY}/v2/${REPOSITORY_PATH}/manifests/${tag}`, {
    method: 'HEAD',
    headers: { Accept: MANIFEST_TYPES, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  })
  const digest = manifest.headers.get('docker-content-digest')

  if (!manifest.ok || !digest || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    // A release naming a tag the registry never published is the shape both a forged and
    // a mistaken release take, so it is worth seeing rather than only retrying.
    logEvent('warn', 'runtime.image_tag_unpublished', { tag, status: manifest.status })

    return undefined
  }

  return digest
}

function publishedDigest(tag: string): Promise<string | undefined> {
  const cached = digests.get(tag)

  if (cached && cached.expires > Date.now()) return cached.result
  // A reconcile tick walks the fleet one runtime at a time, so the entry has to outlive
  // this promise: expiring a miss only once it has settled would make every later runtime
  // in the same tick repeat the lookup, and a registry timing out turns that into one
  // five-second wait per agent.
  const entry = { expires: Infinity, result: lookUpDigest(tag).catch(() => undefined) }

  digests.set(tag, entry)
  void entry.result.then((digest) => {
    if (!digest) entry.expires = Date.now() + MISS_TTL_MS
  })

  return entry.result
}

/**
 * The image a managed agent runs: the version an administrator pinned, otherwise the
 * latest published release, named by the digest the registry serves for that tag.
 *
 * A release body is editable and a tag is mutable; a digest is neither, so a release can
 * influence which published image runs, never which bytes run. A version the registry does
 * not serve resolves to `undefined`, and a caller that must name an image retries instead.
 */
export async function managedRuntimeImage(
  provider: OpenAbProvider,
  requestedVersion?: string,
): Promise<string | undefined> {
  const version = stableRuntimeVersion(requestedVersion)
    ? requestedVersion
    : (await latestRuntimeRelease(provider))?.version

  if (!version) return undefined
  const tag = `${version}-${provider}`
  const digest = await publishedDigest(tag)

  return digest ? `${NUPHOS_RUNTIME_REPOSITORY}:${tag}@${digest}` : undefined
}
