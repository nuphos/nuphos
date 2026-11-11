// One-click "import this computer's skill into the team or personal store": resolve the
// skill against what listLocalSkills found, then read and upload its files one
// at a time under `skills/<name>/`.
import { teamSkillsPutObject } from '../atlas'

import { recordReviewedLinks } from './local-setup-snapshot'

import {
  listLocalSkills,
  localSkillEntries,
  matchesReview,
  MAX_SKILL_FILE_BYTES,
  readSkillFile,
} from './local-skills'

import type { LocalSkillReviewedFile, LocalSkillSource } from './local-skills'
import type { SkillScope } from '../atlas'

export type LocalSkillImportResult = {
  name: string
  source: LocalSkillSource
  /** Object keys written, in upload order. */
  keys: string[]
  /** Files left behind because the store would reject them. */
  skipped: string[]
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

export async function importLocalSkill(
  teamId: string,
  /** The `id` of a skill `listLocalSkills` returned. */
  id: string,
  scope: SkillScope | undefined,
  /** The files the member confirmed: nothing else is uploaded. */
  reviewed: readonly LocalSkillReviewedFile[],
): Promise<LocalSkillImportResult> {
  // Never take a directory the renderer names: the listing main just produced is
  // the whole allow-list, and each file is read where localSkillEntries resolved it.
  const skill = (await listLocalSkills()).find((candidate) => candidate.id === id)

  if (!skill) throw new Error(`No skill "${id}" on this computer.`)
  const entries = await localSkillEntries(skill.path)

  // A link re-pointed since the review would upload a file the member never saw.
  if (!matchesReview(entries, reviewed)) {
    throw new Error(`${skill.name} changed since you reviewed it. Open the import list again.`)
  }
  const keys: string[] = []
  const skipped: string[] = []

  // One file in memory at a time, uploaded before the next is read: the store
  // versions each object anyway, and the main process gains nothing from holding
  // a whole skill (up to 200 files) at once.
  for (const entry of entries) {
    if (entry.size > MAX_SKILL_FILE_BYTES) {
      skipped.push(entry.relPath)
      continue
    }
    const key = `skills/${skill.name}/${entry.relPath}`
    const bytes = new Uint8Array(await readSkillFile(entry))

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
    keys.push(key)
  }

  // The member reviewed these links, so this team's sync may follow them too.
  if (skill.source === 'claude') await recordReviewedLinks(teamId, skill, reviewed)

  return { name: skill.name, source: skill.source, keys, skipped }
}
