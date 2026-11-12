// "Import from this computer": upload the skills the member picked and reviewed
// into the team or personal store, each under `skills/<name>/`. Every skill is
// resolved against what listLocalSkills found, checked against its review, and
// imported on its own, so one that is skipped or fails never stops the rest.
import { atlasErrorInfo } from '../atlas/error.ts'
import { teamSkillsListObjects, teamSkillsPutObject } from '../atlas.ts'

import { recordReviewedLinks } from './local-setup-snapshot.ts'
import {
  listLocalSkills,
  localSkillEntries,
  matchesReview,
  MAX_SKILL_FILE_BYTES,
  readSkillFile,
} from './local-skills.ts'

import type { LocalSkillInfo, LocalSkillReviewedFile } from './local-skills.ts'
import type { SkillScope } from '../atlas.ts'

/** One skill the member picked, with the files they reviewed for it. */
export type LocalSkillImportPick = { id: string; reviewed: LocalSkillReviewedFile[] }

export type LocalSkillImportOutcome = {
  id: string
  name: string
  status: 'imported' | 'skipped' | 'failed'
  /** Why it was skipped or failed. */
  reason?: 'name_taken' | 'builtin' | 'changed' | 'missing' | 'error'
  /** The store's or the reader's own words, for `error`. */
  message?: string
  /** Object keys written, in upload order. */
  keys: string[]
  /** Files left behind because the store would reject them for size. */
  tooLarge: string[]
}

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.sh': 'text/x-shellscript',
  '.txt': 'text/plain',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

function contentType(relPath: string): string | undefined {
  const dot = relPath.lastIndexOf('.')

  return dot === -1 ? undefined : CONTENT_TYPES[relPath.slice(dot).toLowerCase()]
}

/** Skill names that already have objects in the target store. */
async function storeSkillNames(teamId: string, scope: SkillScope | undefined) {
  const listing = (await teamSkillsListObjects(teamId, scope)) as { objects: { key: string }[] }

  return new Set(listing.objects.map((object) => /^skills\/([^/]+)\//u.exec(object.key)?.[1]))
}

async function importOne(
  teamId: string,
  scope: SkillScope | undefined,
  skill: LocalSkillInfo,
  reviewed: readonly LocalSkillReviewedFile[],
): Promise<LocalSkillImportOutcome> {
  const outcome: LocalSkillImportOutcome = {
    id: skill.id,
    name: skill.name,
    status: 'imported',
    keys: [],
    tooLarge: [],
  }
  const entries = await localSkillEntries(skill.path)

  // A link re-pointed since the review would upload a file the member never saw.
  if (!matchesReview(entries, reviewed)) return { ...outcome, status: 'failed', reason: 'changed' }
  // One file in memory at a time, uploaded before the next is read: the store
  // versions each object anyway, and main gains nothing from holding a whole skill.
  for (const entry of entries) {
    if (entry.size > MAX_SKILL_FILE_BYTES) {
      outcome.tooLarge.push(entry.relPath)
      continue
    }
    const key = `skills/${skill.name}/${entry.relPath}`
    const bytes = new Uint8Array(await readSkillFile(entry))

    try {
      await teamSkillsPutObject(
        teamId,
        key,
        {
          filename: entry.relPath.split('/').pop() ?? entry.relPath,
          bytes,
          contentType: contentType(entry.relPath),
        },
        scope,
      )
    } catch (e) {
      const { code, message } = atlasErrorInfo(e)

      // The store refuses a built-in skill's name on the first file, before any write.
      if (code === 'reserved_skill_name')
        return { ...outcome, status: 'skipped', reason: 'builtin' }
      throw new Error(message, { cause: e })
    }
    outcome.keys.push(key)
  }
  // The member reviewed these links, so this team's sync may follow them too.
  if (skill.source === 'claude') await recordReviewedLinks(teamId, skill, reviewed)

  return outcome
}

export async function importLocalSkills(
  teamId: string,
  scope: SkillScope | undefined,
  /** Skills `listLocalSkills` returned, with the files the member confirmed. */
  picks: readonly LocalSkillImportPick[],
): Promise<LocalSkillImportOutcome[]> {
  // Never take a directory the renderer names: the listing main just produced is
  // the whole allow-list, and each file is read where localSkillEntries resolved it.
  const skills = new Map((await listLocalSkills()).map((skill) => [skill.id, skill]))
  const taken = await storeSkillNames(teamId, scope)
  const outcomes: LocalSkillImportOutcome[] = []

  for (const pick of picks) {
    const skill = skills.get(pick.id)
    const base = { id: pick.id, name: skill?.name ?? pick.id, keys: [], tooLarge: [] }

    if (!skill) outcomes.push({ ...base, status: 'failed', reason: 'missing' })
    // Never overwrite a skill already in the store: importing is for new ones.
    else if (taken.has(skill.name))
      outcomes.push({ ...base, status: 'skipped', reason: 'name_taken' })
    else {
      const outcome = await importOne(teamId, scope, skill, pick.reviewed).catch(
        (e: unknown): LocalSkillImportOutcome => ({
          ...base,
          status: 'failed',
          reason: 'error',
          message: e instanceof Error ? e.message : String(e),
        }),
      )

      // Two local skills can share a name (Claude Code and Codex): the second is taken.
      if (outcome.status === 'imported') taken.add(skill.name)
      outcomes.push(outcome)
    }
  }

  return outcomes
}
