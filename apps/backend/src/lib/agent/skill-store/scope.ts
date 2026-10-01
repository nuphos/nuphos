// Scope identifies a skills namespace in S3 and on the local cache.
// Examples: "global", "teams/<teamObjectId>".

const SCOPE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function normalizeSkillScope(scope: string): string {
  const trimmed = scope.trim()

  if (!trimmed) throw new Error('Skill scope must be non-empty')
  if (trimmed.includes('..')) throw new Error(`Invalid skill scope: ${JSON.stringify(scope)}`)
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    throw new Error(`Invalid skill scope: ${JSON.stringify(scope)}`)
  }

  const segments = trimmed.split('/').filter(Boolean)

  if (segments.length === 0) throw new Error('Skill scope must be non-empty')

  for (const segment of segments) {
    if (!SCOPE_SEGMENT.test(segment)) {
      throw new Error(`Invalid skill scope segment: ${JSON.stringify(segment)}`)
    }
  }

  return segments.join('/')
}

export function skillScopeS3Prefix(scope: string): string {
  const normalized = normalizeSkillScope(scope)

  return `${normalized}/skills/`
}

/** Strip "{scope}/" from a full S3 object key; result is cache-relative (e.g. skills/foo/SKILL.md). */
export function s3KeyToCacheRelativePath(scope: string, s3Key: string): string {
  const normalized = normalizeSkillScope(scope)
  const prefix = `${normalized}/`

  if (!s3Key.startsWith(prefix)) {
    throw new Error(
      `S3 key ${JSON.stringify(s3Key)} is outside scope ${JSON.stringify(normalized)}`,
    )
  }
  const rel = s3Key.slice(prefix.length)

  if (!rel || rel.endsWith('/')) {
    throw new Error(`S3 key ${JSON.stringify(s3Key)} is not a file object`)
  }

  return rel.split('/').join('/') // posix
}

export function skillObjectKey(scope: string, relativeKey: string): string {
  const normalized = normalizeSkillScope(scope)
  const cleaned = relativeKey.replace(/^\/+/, '').split('/').join('/')

  if (!cleaned || cleaned.endsWith('/') || cleaned.includes('..')) {
    throw new Error(`Invalid skill object key: ${JSON.stringify(relativeKey)}`)
  }

  return `${normalized}/${cleaned}`
}
