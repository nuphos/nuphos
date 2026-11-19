// What a "sync my setup" pass may read: each skill in the synced folders hashed
// as it is now (a name in two folders only from the first), except a skill that
// links outside its own folder, which is not read at all until the member has
// reviewed exactly those links (approveLinkedSkill, or the Import review).
// Automatic sync has no confirm step of its own.
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { MAX_SYNCED_FILE_BYTES } from './local-setup-plan.ts'
import { readTeam, stateKey, syncFolders, updateTeam } from './local-setup-state.ts'
import {
  listSkillsIn,
  matchesReview,
  outsideFiles,
  readSkillFile,
  walkSkill,
} from './local-skills.ts'

import type { LocalSkillSnapshot, SkippedSkill } from './local-setup-plan.ts'
import type { ApprovedLinks, FileHash, HashCache } from './local-setup-state.ts'
import type { LocalSkillEntry, LocalSkillInfo, LocalSkillReviewedFile } from './local-skills.ts'

export type SkillSnapshot = LocalSkillSnapshot & {
  entries: Map<string, LocalSkillEntry>
  folder: string
}

/**
 * The skills of `folders`, each name once: from the first folder that has it.
 * A later folder's copy is not synced, and is reported rather than dropped
 * unseen, so the member knows which copy is in Nuphos.
 */
export async function skillsOfFolders(folders: readonly string[]) {
  const listed = await Promise.all(folders.map((folder) => listSkillsIn(folder, 'folder')))
  const syncedFrom = new Map<string, string>()
  const skills: (LocalSkillInfo & { folder: string })[] = []
  const clashes: SkippedSkill[] = []

  for (const [index, folder] of folders.entries()) {
    for (const skill of listed[index] ?? []) {
      const first = syncedFrom.get(skill.name)

      if (first) clashes.push({ name: skill.name, reason: 'name_clash', folder, syncedFrom: first })
      else {
        syncedFrom.set(skill.name, folder)
        skills.push({ ...skill, folder })
      }
    }
  }

  return { skills, clashes }
}

/** Whether every link out of `skill` is one the member approved, to the same place. */
export function linksReviewed(skill: LocalSkillInfo, approved: ApprovedLinks): boolean {
  return outsideFiles(skill).every((file) => approved[skill.name]?.[file.relPath] === file.realPath)
}

/** Record `files`' links out of the skill as reviewed, for this team's sync. */
export async function recordReviewedLinks(
  teamId: string,
  skill: LocalSkillInfo,
  files: readonly LocalSkillReviewedFile[],
) {
  const key = await stateKey(teamId)
  const out = new Set(outsideFiles(skill).map((file) => file.relPath))
  const links = files.filter((file) => out.has(file.relPath))

  updateTeam(key, (team) => {
    team.approvedLinks = {
      ...team.approvedLinks,
      [skill.name]: Object.fromEntries(links.map((file) => [file.relPath, file.realPath])),
    }
  })
}

/** The Sync my setup review: approve a skill's links only as the member saw them. */
export async function approveLinkedSkill(
  teamId: string,
  name: string,
  reviewed: readonly LocalSkillReviewedFile[],
) {
  const folders = syncFolders(readTeam(await stateKey(teamId)))
  const skill = (await skillsOfFolders(folders)).skills.find((candidate) => candidate.name === name)

  if (!skill) throw new Error(`No skill "${name}" on this computer.`)
  if (!matchesReview((await walkSkill(skill.path)).entries, reviewed)) {
    throw new Error(`${name} changed since you reviewed it. Review it again.`)
  }
  await recordReviewedLinks(teamId, skill, reviewed)
}

/** Hash and actual length: a file can report size 0 (procfs) and still have content. */
async function hashFile(full: string, entry: LocalSkillEntry, cache: HashCache, seen: HashCache) {
  const { realPath, size, mtimeMs } = entry

  // The planner leaves a file over the cap behind, so never read one.
  if (size > MAX_SYNCED_FILE_BYTES) return { sha256: '', bytes: size }
  const cached = cache[full] as FileHash | undefined
  let hashed: FileHash

  // A file reporting size 0 (procfs) can change without its stat changing: read it.
  if (
    size > 0 &&
    cached?.size === size &&
    cached.mtimeMs === mtimeMs &&
    cached.realPath === realPath
  ) {
    hashed = cached
  } else {
    const content = await readSkillFile(entry)

    hashed = {
      size,
      mtimeMs,
      realPath,
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
  }
  seen[full] = hashed

  return { sha256: hashed.sha256, bytes: hashed.bytes ?? size }
}

/**
 * `sources` is the folder each skill synced from last time: a folder that cannot
 * be read now (a drive not mounted) holds what it synced, like an unreadable file.
 */
export async function snapshotLocalSkills(
  folders: readonly string[],
  cache: HashCache,
  approved: ApprovedLinks,
  sources: Readonly<Record<string, string>> = {},
): Promise<{ skills: SkillSnapshot[]; hashes: HashCache; clashes: SkippedSkill[] }> {
  const { skills, clashes } = await skillsOfFolders(folders)
  const out: SkillSnapshot[] = []
  // Only files that still exist keep a cache entry.
  const seen: HashCache = {}

  for (const skill of skills) {
    const { folder } = skill

    if (!linksReviewed(skill, approved)) {
      out.push({ name: skill.name, folder, entries: new Map(), files: [], unreviewed: true })
      continue
    }
    const { entries, truncated } = await walkSkill(skill.path)
    const byPath = new Map(entries.map((entry) => [entry.relPath, entry]))
    const files = []

    try {
      // Read only what the reviewed listing named: a link re-pointed since is not.
      if (!matchesReview(entries, skill.files)) throw new Error('changed while listing')
      for (const entry of entries) {
        const full = path.join(skill.path, entry.relPath)
        const { sha256, bytes } = await hashFile(full, entry, cache, seen)

        files.push({ relPath: entry.relPath, size: bytes, sha256 })
      }
      out.push({ name: skill.name, folder, entries: byPath, files, truncated })
    } catch (e) {
      // One unreadable file skips only its own skill, which the planner holds.
      console.warn(`local-setup: could not read ${skill.name}`, e)
      out.push({ name: skill.name, folder, entries: new Map(), files: [] })
    }
  }
  const missing = await Promise.all(
    folders.map(async (folder) => !(await fs.stat(folder).catch(() => null))?.isDirectory()),
  )

  for (const [name, folder] of Object.entries(sources)) {
    if (missing[folders.indexOf(folder)] && !out.some((skill) => skill.name === name)) {
      out.push({ name, folder, entries: new Map(), files: [] })
    }
  }

  return { skills: out, hashes: seen, clashes }
}
