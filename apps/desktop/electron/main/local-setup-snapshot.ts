// What a "sync my setup" pass may read: each Claude Code skill hashed as it is
// now, except a skill that links outside its own folder, which is not read at all
// until the member has reviewed exactly those links (approveLinkedSkill, or the
// Import review). Automatic sync has no confirm step of its own.
import { createHash } from 'node:crypto'
import path from 'node:path'

import { MAX_SYNCED_FILE_BYTES } from './local-setup-plan.ts'
import { stateKey, updateTeam } from './local-setup-state.ts'
import {
  listLocalSkills,
  matchesReview,
  outsideFiles,
  readSkillFile,
  walkSkill,
} from './local-skills.ts'

import type { LocalSkillSnapshot } from './local-setup-plan.ts'
import type { ApprovedLinks, FileHash, HashCache } from './local-setup-state.ts'
import type { LocalSkillEntry, LocalSkillInfo, LocalSkillReviewedFile } from './local-skills.ts'

export type SkillSnapshot = LocalSkillSnapshot & { entries: Map<string, LocalSkillEntry> }

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
  const skill = (await listLocalSkills()).find(
    (candidate) => candidate.source === 'claude' && candidate.name === name,
  )

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

  if (cached?.size === size && cached.mtimeMs === mtimeMs && cached.realPath === realPath) {
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

/** Claude Code skills only: Codex keeps its own, and a name can exist under both. */
export async function snapshotLocalSkills(
  cache: HashCache,
  approved: ApprovedLinks,
): Promise<{ skills: SkillSnapshot[]; hashes: HashCache }> {
  const skills = (await listLocalSkills()).filter((skill) => skill.source === 'claude')
  const out: SkillSnapshot[] = []
  // Only files that still exist keep a cache entry.
  const seen: HashCache = {}

  for (const skill of skills) {
    if (!linksReviewed(skill, approved)) {
      out.push({ name: skill.name, entries: new Map(), files: [], unreviewed: true })
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
      out.push({ name: skill.name, entries: byPath, files, truncated })
    } catch (e) {
      // One unreadable file skips only its own skill, which the planner holds.
      console.warn(`local-setup: could not read ${skill.name}`, e)
      out.push({ name: skill.name, entries: new Map(), files: [] })
    }
  }

  return { skills: out, hashes: seen }
}
