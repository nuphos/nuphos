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

function mergedRoot(): string {
  return safeJoinUnder(getSkillsCacheRoot(), '.merged')
}

function mergeOutputRoot(teamId: string | null | undefined): string {
  return safeJoinUnder(mergedRoot(), teamId ? `team-${teamId}` : 'solo')
}

// Each tree lives in a directory named after its inputs and is never written once
// published, so a request can read it while another builds the next one.
function mergeOutputDir(teamId: string | null | undefined, fingerprint: string): string {
  const name = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)

  return safeJoinUnder(mergeOutputRoot(teamId), name)
}

function fingerprintPath(outDir: string): string {
  return safeJoinUnder(outDir, FINGERPRINT_FILE)
}

async function readStoredFingerprint(outDir: string): Promise<string | null> {
  try {
    return (await fs.readFile(fingerprintPath(outDir), 'utf8')).trim() || null
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

// Builtin skills ship inside the image and never change while it runs, so one
// read per process is enough.
let builtin: Promise<string> | undefined

function builtinRevision(): Promise<string> {
  builtin ??= hashBuiltinSkills().catch((err: unknown) => {
    builtin = undefined
    throw err
  })

  return builtin
}

async function hashBuiltinSkills(): Promise<string> {
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

/**
 * What the tree `resolveSkillsDirectory` returned was built from; changes whenever the
 * tree does. Cheap: no skill file is read. Empty for the builtin tree, which never changes.
 */
export async function mergedSkillsFingerprint(directory: string): Promise<string> {
  return (await readStoredFingerprint(directory)) ?? ''
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

async function overlayScopeSkills(
  destRoot: string,
  scope: string,
  builtinNames: Set<string>,
): Promise<string[]> {
  const scopeDir = getScopeCacheDir(scope)
  const names = (await listCachedSkillNames(scopeDir)).filter((name) => !builtinNames.has(name))

  for (const name of names) {
    const src = safeJoinUnder(scopeDir, path.posix.join('skills', name))

    await copySkillTree(src, destRoot, name)
  }

  return names
}

async function treeSkillNames(dir: string): Promise<string[]> {
  return (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byCodeUnit)
}

async function materializeMergeTree(
  teamId: string | null | undefined,
  outDir: string,
): Promise<MergedSkillsResult> {
  const builtinNames = await treeSkillNames(getBuiltinSkillsDirectory())

  for (const name of builtinNames) {
    const src = safeJoinUnder(getBuiltinSkillsDirectory(), name)

    await copySkillTree(src, outDir, name)
  }

  const reservedNames = new Set(builtinNames)
  const globalNames = await overlayScopeSkills(outDir, 'global', reservedNames)
  const teamNames = teamId ? await overlayScopeSkills(outDir, `teams/${teamId}`, reservedNames) : []

  return {
    directory: outDir,
    skillNames: await treeSkillNames(outDir),
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
  const fingerprint = JSON.stringify(await buildFingerprint(teamId))
  const outDir = mergeOutputDir(teamId, fingerprint)
  const stored = await readStoredFingerprint(outDir)

  if (stored === fingerprint) {
    const layers = { builtinSkills: 0, globalSkills: 0, teamSkills: 0 }

    return { directory: outDir, skillNames: await treeSkillNames(outDir), rebuilt: false, layers }
  }

  // Build beside the published trees and move the finished tree into place in one rename,
  // so concurrent builds never share files and no reader sees a half-copied tree.
  await fs.mkdir(mergedRoot(), { recursive: true })
  const tmp = await fs.mkdtemp(path.join(mergedRoot(), '.build-'))

  try {
    const result = await materializeMergeTree(teamId, tmp)

    await fs.writeFile(fingerprintPath(tmp), fingerprint, 'utf8')
    // A tree whose recorded inputs don't match its name was tampered with; replace it.
    if (stored !== null) await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(mergeOutputRoot(teamId), { recursive: true })
    // Fails when another request published the same inputs first; its tree is identical.
    await fs.rename(tmp, outDir).catch(async (err: unknown) => {
      if ((await readStoredFingerprint(outDir)) !== fingerprint) throw err
    })
    await removeOtherTrees(teamId, outDir)

    return { ...result, directory: outDir }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

const REPLACED_TREE_GRACE_MS = 10 * 60_000 // lets readers of a replaced tree finish

async function removeOtherTrees(teamId: string | null | undefined, keep: string): Promise<void> {
  const root = mergeOutputRoot(teamId)
  const cutoff = Date.now() - REPLACED_TREE_GRACE_MS

  for (const name of await fs.readdir(root)) {
    const dir = safeJoinUnder(root, name)
    const stat = dir === keep ? null : await fs.stat(dir).catch(() => null)

    if (stat && stat.mtimeMs < cutoff) await fs.rm(dir, { recursive: true, force: true })
  }
}

/** Builtin only when store is unused; otherwise merged tree (global + optional team). */
export async function invalidateMergedSkillsCache(teamId?: string | null): Promise<void> {
  await fs.rm(mergeOutputRoot(teamId), { recursive: true, force: true })
}

export async function invalidateMergedSkillsForScope(scope: string): Promise<void> {
  const normalized = normalizeSkillScope(scope)

  if (normalized === 'global') {
    await invalidateMergedSkillsCache(null)

    return
  }
  const [root, teamId, ...nested] = normalized.split('/')

  // A personal scope (teams/<id>/users/<id>) is not part of the shared merged tree.
  if (root === 'teams' && teamId && nested.length === 0) {
    await invalidateMergedSkillsCache(teamId)
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
