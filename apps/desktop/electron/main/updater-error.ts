export type UpdaterErrorCategory =
  | 'signature_validation'
  | 'read_only_volume'
  | 'staging_filesystem'
  | 'channel_manifest'
  | 'network'
  | 'other'

export function classifyUpdaterError(message: string): UpdaterErrorCategory {
  const value = message.toLowerCase()

  if (value.includes('code signature at url')) return 'signature_validation'
  if (value.includes('read-only volume')) return 'read_only_volume'
  if (value.includes('no such file or directory') || value.startsWith('ditto:')) {
    return 'staging_filesystem'
  }
  if (/\b(?:403|404)\b/.test(value) || value.includes('channel file')) return 'channel_manifest'
  if (
    value.includes('net::err_') ||
    value.includes('fetch failed') ||
    value.includes('econn') ||
    value.includes('enotfound') ||
    value.includes('timed out') ||
    value.includes('timeout error')
  ) {
    return 'network'
  }

  return 'other'
}

export function updaterTelemetryError(error: Error): Error {
  const normalized = error.message
    .replaceAll(/\/Users\/[^/]+\//g, '/Users/<redacted>/')
    .replaceAll(/([A-Za-z]:\\Users\\)[^\\]+\\/g, '$1<redacted>\\')
    .replaceAll(/\/home\/[^/]+\//g, '/home/<redacted>/')
    .replaceAll(/:\/\/[^/\s@]+@/g, '://<redacted>@')
    .replaceAll(/update\.[A-Za-z0-9]+/g, 'update.<id>')
  const result = new Error(normalized)

  result.name = error.name

  return result
}

/** Squirrel can emit the same failure several times for one check, while the
 * five-minute poll repeats persistent failures. Capture each category once per
 * app process; state updates still reach the UI on every occurrence. */
export function createUpdaterErrorDedupe(): (category: UpdaterErrorCategory) => boolean {
  const captured = new Set<UpdaterErrorCategory>()

  return (category) => {
    if (captured.has(category)) return false
    captured.add(category)

    return true
  }
}
