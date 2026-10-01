import path from 'node:path'

// Validate that a relative key (from an S3 object listing or an etag manifest)
// resolves strictly inside `baseDir`. Rejects absolute paths, `..` traversal,
// NUL bytes, and empty strings.
//
// Used on both the sandbox-side curl target (inject.ts) and the backend-side
// cache write (sync.ts) so a hostile or accidentally-malformed key can't write
// or delete files outside the intended root.
export function safeJoinUnder(baseDir: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error(`Invalid skill key: ${JSON.stringify(relPath)}`)
  }
  if (relPath.includes('\0')) {
    throw new Error(`Skill key contains NUL byte: ${JSON.stringify(relPath)}`)
  }
  const normalized = path.posix.normalize(relPath.split(path.sep).join('/'))

  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Skill key escapes destination: ${JSON.stringify(relPath)}`)
  }
  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(resolvedBase, normalized)

  // Belt-and-suspenders: even after the textual checks, verify the resolved
  // absolute path is under baseDir (catches symlink-style edge cases the
  // textual check wouldn't see if path semantics differ later).
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Skill key escapes destination: ${JSON.stringify(relPath)}`)
  }

  return resolved
}
