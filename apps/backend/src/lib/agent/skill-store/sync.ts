import { promises as fs } from 'node:fs'
import path from 'node:path'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { safeJoinUnder } from './safe-path'
import { normalizeSkillScope, s3KeyToCacheRelativePath, skillScopeS3Prefix } from './scope'
import { getSkillsStore, isSkillsS3Configured } from './skills-s3'

import type { SkillS3Object } from './skills-s3'

const MANIFEST_FILE = '.manifest.json'

type ManifestEntry = {
  etag: string
  size: number
  lastModified: string | null
}

type ScopeManifest = {
  scope: string
  syncedAt: string
  objects: Record<string, ManifestEntry>
}

export type SkillSyncResult = {
  scope: string
  cacheDir: string
  downloaded: number
  deleted: number
  skipped: number
  totalBytes: number
}

export function isSkillsStoreConfigured(): boolean {
  return isSkillsS3Configured()
}

export function getSkillsCacheRoot(): string {
  return config.skillsStore.cacheDir
}

/** Local directory holding synced objects for a scope (e.g. .../cache/global). */
export function getScopeCacheDir(scope: string): string {
  const normalized = normalizeSkillScope(scope)
  const segments = normalized.split('/')

  return safeJoinUnder(getSkillsCacheRoot(), path.join(...segments))
}

function manifestPath(scopeDir: string): string {
  return safeJoinUnder(scopeDir, MANIFEST_FILE)
}

export async function readScopeManifest(scope: string): Promise<ScopeManifest | null> {
  const normalized = normalizeSkillScope(scope)
  const scopeDir = getScopeCacheDir(normalized)

  return readManifest(scopeDir, normalized)
}

/** Revision token for merge cache invalidation; null when scope was never synced. */
export async function getScopeSyncRevision(scope: string): Promise<string | null> {
  const manifest = await readScopeManifest(scope)

  return manifest?.syncedAt ?? null
}

async function readManifest(scopeDir: string, scope: string): Promise<ScopeManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath(scopeDir), 'utf8')
    const parsed = JSON.parse(raw) as ScopeManifest

    if (parsed.scope !== scope || !parsed.objects || typeof parsed.objects !== 'object') {
      return null
    }

    return parsed
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (err instanceof SyntaxError) return null
    throw err
  }
}

async function writeManifest(scopeDir: string, manifest: ScopeManifest): Promise<void> {
  await fs.mkdir(scopeDir, { recursive: true })
  const tmp = safeJoinUnder(scopeDir, `${MANIFEST_FILE}.tmp`)
  const dest = manifestPath(scopeDir)

  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  await fs.rename(tmp, dest)
}

function needsDownload(
  relPath: string,
  obj: SkillS3Object,
  previous: ScopeManifest | null,
): boolean {
  const prior = previous?.objects[relPath]

  if (!prior) return true

  return prior.etag !== obj.etag || prior.size !== obj.size
}

/** Remove cached skill directories that are completely empty (ghost dirs left after S3 delete). */
async function isEmptyDirTree(dir: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[]

  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw err
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name)

    if (entry.isFile()) return false
    if (entry.isDirectory() && !(await isEmptyDirTree(child))) return false
  }

  return true
}

export async function pruneInvalidCachedSkillDirs(scopeDir: string): Promise<number> {
  const skillsRoot = safeJoinUnder(scopeDir, 'skills')
  let entries: import('node:fs').Dirent[]

  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }

  let pruned = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = safeJoinUnder(skillsRoot, entry.name)

    if (!(await isEmptyDirTree(skillDir))) continue
    await fs.rm(skillDir, { recursive: true, force: true })
    pruned += 1
  }

  return pruned
}

export async function syncScope(scope: string): Promise<SkillSyncResult> {
  if (!isSkillsStoreConfigured()) {
    throw new AppError(
      503,
      'skills_store_unconfigured',
      'Skills store is not configured on this server',
    )
  }

  const normalized = normalizeSkillScope(scope)
  const scopeDir = getScopeCacheDir(normalized)
  const s3 = getSkillsStore({ scope: normalized })
  const prefix = skillScopeS3Prefix(normalized)

  const remoteObjects = await s3.listUnderPrefix(prefix)
  const previous = await readManifest(scopeDir, normalized)

  let downloaded = 0
  let skipped = 0
  let totalBytes = 0
  const nextObjects: Record<string, ManifestEntry> = {}

  for (const obj of remoteObjects) {
    const relPath = s3KeyToCacheRelativePath(normalized, obj.key)

    nextObjects[relPath] = {
      etag: obj.etag,
      size: obj.size,
      lastModified: obj.lastModified?.toISOString() ?? null,
    }

    if (!needsDownload(relPath, obj, previous)) {
      skipped += 1
      totalBytes += obj.size
      continue
    }

    const body = await s3.getObjectBody(obj.key)
    const dest = safeJoinUnder(scopeDir, relPath)

    await fs.mkdir(path.dirname(dest), { recursive: true })
    const tmp = `${dest}.tmp`

    await fs.writeFile(tmp, body)
    await fs.rename(tmp, dest)
    downloaded += 1
    totalBytes += body.byteLength
  }

  let deleted = 0
  const remoteRelPaths = new Set(
    remoteObjects.map((obj) => s3KeyToCacheRelativePath(normalized, obj.key)),
  )

  if (previous) {
    for (const relPath of Object.keys(previous.objects)) {
      if (remoteRelPaths.has(relPath)) continue
      const stale = safeJoinUnder(scopeDir, relPath)

      try {
        await fs.unlink(stale)
        deleted += 1
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
  }

  const pruned = await pruneInvalidCachedSkillDirs(scopeDir)

  if (previous && downloaded === 0 && deleted === 0 && pruned === 0) {
    return {
      scope: normalized,
      cacheDir: scopeDir,
      downloaded,
      deleted,
      skipped,
      totalBytes,
    }
  }

  if (previous && downloaded === 0 && deleted === 0 && pruned > 0) {
    await writeManifest(scopeDir, {
      ...previous,
      syncedAt: new Date().toISOString(),
    })

    return {
      scope: normalized,
      cacheDir: scopeDir,
      downloaded,
      deleted: deleted + pruned,
      skipped,
      totalBytes,
    }
  }

  await writeManifest(scopeDir, {
    scope: normalized,
    syncedAt: new Date().toISOString(),
    objects: nextObjects,
  })

  return {
    scope: normalized,
    cacheDir: scopeDir,
    downloaded,
    deleted,
    skipped,
    totalBytes,
  }
}
