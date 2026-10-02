import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { byCodeUnit } from '@/lib/agent/sort-order'

import { collectSkillFiles, getBuiltinSkillsDirectory } from './inject'
import { safeJoinUnder } from './safe-path'
import { normalizeSkillScope } from './scope'
import {
  getScopeCacheDir,
  getScopeSyncRevision,
  getSkillsCacheRoot,
  isSkillsStoreConfigured,
  syncScope,
} from './sync'

const FINGERPRINT_FILE = '.merge-fingerprint'

export type MergedSkillsResult = {
  directory: string
  skillNames: string[]
  rebuilt: boolean
  layers: {
    builtinSkills: number
    globalSkills: number
    teamSkills: number
  }
}

type MergeFingerprint = {
  version: 2
  builtin: string
  global: string | null
  team: string | null
}

function mergeOutputDir(teamId: string | null | undefined): string {
  const key = teamId ? `team-${teamId}` : 'solo'

  return safeJoinUnder(getSkillsCacheRoot(), path.posix.join('.merged', key))
}

async function fingerprintPath(outDir: string): Promise<string> {
  return safeJoinUnder(outDir, FINGERPRINT_FILE)
}

async function readStoredFingerprint(outDir: string): Promise<string | null> {
  try {
    return (await fs.readFile(await fingerprintPath(outDir), 'utf8')).trim() || null
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function builtinRevision(): Promise<string> {
  const files = await collectSkillFiles(getBuiltinSkillsDirectory())
  const hash = createHash('sha256')

  for (const file of files.toSorted((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(file.relPath)
    hash.update('\0')
    hash.update(file.content)
    hash.update('\0')
  }

  return hash.digest('hex')
}

async function buildFingerprint(teamId: string | null | undefined): Promise<MergeFingerprint> {
  return {
    version: 2,
    builtin: await builtinRevision(),
    global: await getScopeSyncRevision('global'),
    team: teamId ? await getScopeSyncRevision(`teams/${teamId}`) : null,
  }
}

function serializeFingerprint(fp: MergeFingerprint): string {
  return JSON.stringify(fp)
}

async function listCachedSkillNames(scopeDir: string): Promise<string[]> {
  const skillsRoot = safeJoinUnder(scopeDir, 'skills')
  let entries: import('node:fs').Dirent[]

  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const names: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMd = safeJoinUnder(skillsRoot, path.posix.join(entry.name, 'SKILL.md'))

    try {
      await fs.access(skillMd)
      names.push(entry.name)
    } catch {
      // Skip ghost dirs left after delete (no SKILL.md → not a valid skill overlay).
    }
  }

  return names.sort(byCodeUnit)
}

async function copySkillTree(
  srcSkillDir: string,
  destRoot: string,
  skillName: string,
): Promise<void> {
  const dest = safeJoinUnder(destRoot, skillName)

  await fs.rm(dest, { recursive: true, force: true })
  await fs.cp(srcSkillDir, dest, { recursive: true })
}

async function listBuiltinSkillNames(): Promise<string[]> {
  const root = getBuiltinSkillsDirectory()
  const entries = await fs.readdir(root, { withFileTypes: true })

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byCodeUnit)
}

async function overlayScopeSkills(
  destRoot: string,
  scope: string,
  builtinNames: Set<string>,
): Promise<string[]> {
  const scopeDir = getScopeCacheDir(scope)
  // Old store entries predate the reserved-name check on writes. They must not
  // shadow credential fixes shipped with the backend.
  const names = (await listCachedSkillNames(scopeDir)).filter((name) => !builtinNames.has(name))

  for (const name of names) {
    const src = safeJoinUnder(scopeDir, path.posix.join('skills', name))

    await copySkillTree(src, destRoot, name)
  }

  return names
}

async function materializeMergeTree(
  teamId: string | null | undefined,
): Promise<MergedSkillsResult> {
  const outDir = mergeOutputDir(teamId)

  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  const builtinNames = await listBuiltinSkillNames()

  for (const name of builtinNames) {
    const src = safeJoinUnder(getBuiltinSkillsDirectory(), name)

    await copySkillTree(src, outDir, name)
  }

  const reservedNames = new Set(builtinNames)
  const globalNames = await overlayScopeSkills(outDir, 'global', reservedNames)
  const teamNames = teamId ? await overlayScopeSkills(outDir, `teams/${teamId}`, reservedNames) : []

  const skillNames = (await fs.readdir(outDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byCodeUnit)

  return {
    directory: outDir,
    skillNames,
    rebuilt: true,
    layers: {
      builtinSkills: builtinNames.length,
      globalSkills: globalNames.length,
      teamSkills: teamNames.length,
    },
  }
}

/**
 * Merge builtin + global + team cached skills into one directory suitable for
 * createSkillTool and sandbox injection. Builtin names are reserved; custom
 * skills retain team > global precedence.
 */
export async function materializeMergedSkillsDir(
  teamId?: string | null,
): Promise<MergedSkillsResult> {
  const outDir = mergeOutputDir(teamId)
  const nextFingerprint = serializeFingerprint(await buildFingerprint(teamId))
  const stored = await readStoredFingerprint(outDir)

  if (stored === nextFingerprint) {
    try {
      const skillNames = (await fs.readdir(outDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && e.name !== FINGERPRINT_FILE)
        .map((e) => e.name)
        .sort(byCodeUnit)

      if (skillNames.length > 0) {
        return {
          directory: outDir,
          skillNames,
          rebuilt: false,
          layers: {
            builtinSkills: 0,
            globalSkills: 0,
            teamSkills: 0,
          },
        }
      }
    } catch {
      // fall through to rebuild
    }
  }

  const result = await materializeMergeTree(teamId)

  await fs.writeFile(await fingerprintPath(outDir), nextFingerprint, 'utf8')

  return result
}

/** Builtin only when store is unused; otherwise merged tree (global + optional team). */
export async function invalidateMergedSkillsCache(teamId?: string | null): Promise<void> {
  const outDir = mergeOutputDir(teamId)

  await fs.rm(outDir, { recursive: true, force: true })
}

export async function invalidateMergedSkillsForScope(scope: string): Promise<void> {
  const normalized = normalizeSkillScope(scope)

  if (normalized === 'global') {
    await invalidateMergedSkillsCache(null)

    return
  }
  if (normalized.startsWith('teams/')) {
    await invalidateMergedSkillsCache(normalized.slice('teams/'.length))
  }
}

export async function resolveSkillsDirectory(teamId?: string | null): Promise<string> {
  if (isSkillsStoreConfigured()) {
    try {
      await syncScope('global')
      if (teamId) {
        await syncScope(`teams/${teamId}`)
      }
    } catch {
      // Fall through to last-cached revision or builtin skills when sync is transiently unavailable.
    }
  }

  const globalRevision = await getScopeSyncRevision('global')
  const teamRevision = teamId ? await getScopeSyncRevision(`teams/${teamId}`) : null

  if (!globalRevision && !teamRevision) {
    return getBuiltinSkillsDirectory()
  }
  const merged = await materializeMergedSkillsDir(teamId)

  return merged.directory
}
