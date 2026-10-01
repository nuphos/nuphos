/** Shared URL shredding for the bound-resource resolvers. */

export function pathSegment(value: string): string {
  return encodeURIComponent(value)
}

/** Decoded, empty-free path segments, or null on malformed percent-encoding. */
export function pathSegments(url: URL): string[] | null {
  try {
    return url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

export function startsWithSegments(segs: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => segs[index] === part)
}

/**
 * AWS and GCP consoles carry the region, project and resource in the hash of a
 * single-page app route (`#/functions/name`, `#logsV2:log-groups/...`), so the
 * hash needs the same treatment as a path.
 */
export function hashParts(url: URL): { path: string; query: URLSearchParams } {
  const raw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const queryAt = raw.indexOf('?')

  if (queryAt === -1) return { path: raw, query: new URLSearchParams() }

  return { path: raw.slice(0, queryAt), query: new URLSearchParams(raw.slice(queryAt + 1)) }
}
