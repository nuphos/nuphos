// One-click "import this computer's skill into the team store": resolve the
// skill against what listLocalSkills found, then read and upload its files one
// at a time under `skills/<name>/`.
import fs from 'node:fs/promises'
import path from 'node:path'

import { teamSkillsPutObject } from '../atlas'

import { listLocalSkills, localSkillEntries, MAX_SKILL_FILE_BYTES } from './local-skills'

import type { LocalSkillSource } from './local-skills'

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
): Promise<LocalSkillImportResult> {
  // Never take a directory the renderer names: the listing main just produced is
  // the whole allow-list, and it already excludes symlinked roots and anything
  // without a SKILL.md — so there is no path to canonicalize or contain here.
  const skill = (await listLocalSkills()).find((candidate) => candidate.id === id)

  if (!skill) throw new Error(`No skill "${id}" on this computer.`)
  const entries = await localSkillEntries(skill.path)
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
    const bytes = new Uint8Array(await fs.readFile(path.join(skill.path, entry.relPath)))

    await teamSkillsPutObject(teamId, key, {
      filename: entry.relPath.split('/').pop() ?? entry.relPath,
      bytes,
      contentType: contentType(entry.relPath),
    })
    keys.push(key)
  }

  return { name: skill.name, source: skill.source, keys, skipped }
}
