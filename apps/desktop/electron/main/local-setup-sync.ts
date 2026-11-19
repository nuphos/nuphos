// "Sync my setup": mirror this computer's skill folders and ~/.claude/CLAUDE.md
// into the signed-in user's personal skills and personal Instructions for a team,
// so every runtime they use starts with the same context their own CLI has. The
// decisions live in local-setup-plan.ts; this module reads disk and calls the API,
// recording each change in local-setup-state.ts as it lands, and
// local-setup-watch.ts re-runs it when files change.
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  createInstruction,
  deleteInstruction,
  listInstructions,
  teamSkillsDeleteObject,
  teamSkillsDeleteSkill,
  teamSkillsListObjects,
  teamSkillsPutObject,
  updateInstruction,
} from '../atlas.ts'

import {
  instructionTitle,
  planSkillSync,
  RUNTIME_BYTE_BUDGET,
  RUNTIME_FILE_BUDGET,
  splitInstruction,
} from './local-setup-plan.ts'
import {
  claudeDir,
  readHashCache,
  readTeam,
  saveHashCache,
  stateKey,
  syncFolders,
  updateTeam,
} from './local-setup-state.ts'
import { linksReviewed, skillsOfFolders, snapshotLocalSkills } from './local-setup-snapshot.ts'
import { codexSkillsDir, outsideFiles, readSkillFile } from './local-skills.ts'

import type { RemoteObject } from './local-setup-plan.ts'
import type { LocalSetupResult, LocalSetupStatus } from './local-setup-state.ts'
import type { LocalSkillEntry } from './local-skills.ts'

export type { LocalSetupResult, LocalSetupStatus } from './local-setup-state.ts'

async function readClaudeMd(): Promise<string | null> {
  return fs.readFile(path.join(claudeDir(), 'CLAUDE.md'), 'utf8').catch(() => null)
}

async function syncInstruction(
  teamId: string,
  key: string,
): Promise<Pick<LocalSetupResult, 'instruction' | 'instructionParts'>> {
  const markdown = (await readClaudeMd())?.trim() ?? ''
  const listing = await listInstructions(teamId)
  const ours = readTeam(key).instructionIds
  // In recorded part order; ids whose instruction is gone are simply dropped.
  const existing = ours.flatMap((id) => listing.personal.filter((item) => item.id === id))
  const others = listing.personal.filter((item) => !ours.includes(item.id))
  const { contentChars, snippetsPerScope, totalContentCharsPerScope } = listing.limits
  const parts = markdown ? splitInstruction(markdown, contentChars) : []
  const roomChars =
    totalContentCharsPerScope - others.reduce((sum, item) => sum + item.content.length, 0)
  const fits =
    parts.length + others.length <= snippetsPerScope &&
    parts.reduce((sum, part) => sum + part.length, 0) <= roomChars
  const wanted = fits ? parts : []

  updateTeam(key, (team) => {
    team.instructionIds = existing.map((item) => item.id)
  })
  // Shrink first, so the scope's total never exceeds its limit mid-pass. Each
  // delete and create is recorded as it lands, so a retry after a failure part-way
  // neither leaves an orphan nor creates a duplicate.
  for (const stale of existing.slice(wanted.length)) {
    await deleteInstruction(teamId, stale.id)
    updateTeam(key, (team) => {
      team.instructionIds = team.instructionIds.filter((id) => id !== stale.id)
    })
  }
  for (const [index, content] of wanted.entries()) {
    const title = instructionTitle(index, wanted.length)
    const current = existing.at(index)

    if (!current) {
      const created = await createInstruction(teamId, { scope: 'personal', title, content })

      updateTeam(key, (team) => {
        team.instructionIds = [...team.instructionIds, created.id]
      })
    } else if (current.title !== title || current.content !== content) {
      await updateInstruction(teamId, current.id, { title, content })
    }
  }

  if (!markdown) return { instruction: existing.length ? 'removed' : 'none', instructionParts: 0 }

  return fits
    ? { instruction: 'synced', instructionParts: wanted.length }
    : { instruction: 'too_long', instructionParts: 0 }
}

const running = new Map<string, Promise<LocalSetupResult>>()

const inFolder = (folder: string) => (skill: { folder?: string }) => skill.folder === folder

/** Upload one file and record its hash for its skill the moment the store has it. */
async function uploadFile(
  teamId: string,
  key: string,
  upload: { name: string; key: string; file: { relPath: string; sha256: string } },
  entry: LocalSkillEntry,
) {
  const bytes = new Uint8Array(await readSkillFile(entry))

  await teamSkillsPutObject(
    teamId,
    upload.key,
    { filename: upload.file.relPath.split('/').pop() ?? upload.file.relPath, bytes },
    'personal',
  )
  updateTeam(key, (team) => {
    team.skills[upload.name] = {
      ...team.skills[upload.name],
      [upload.file.relPath]: upload.file.sha256,
    }
  })
}

async function runSync(teamId: string): Promise<LocalSetupResult> {
  const key = await stateKey(teamId)
  const folders = syncFolders(readTeam(key))
  const snapshot = await snapshotLocalSkills(
    folders,
    readHashCache(),
    readTeam(key).approvedLinks ?? {},
    readTeam(key).sources,
  )
  const local = snapshot.skills

  saveHashCache(snapshot.hashes, folders)
  const listing = (await teamSkillsListObjects(teamId, 'personal')) as { objects: RemoteObject[] }
  const plan = planSkillSync(local, readTeam(key).skills, listing.objects)
  const entries = new Map(local.map((skill) => [skill.name, skill.entries]))
  const failed = new Set<string>()
  let removed = 0

  // Claim every skill about to be uploaded before the first byte goes out, so a
  // pass that stops part-way still owns what it started rather than finding it
  // "taken" next time.
  updateTeam(key, (team) => {
    for (const name of plan.synced) team.skills[name] ??= {}
  })
  for (const name of plan.deleteSkills) {
    // Stays on record when the delete fails, so the next pass retries it.
    try {
      await teamSkillsDeleteSkill(teamId, name, 'personal')
      updateTeam(key, (team) => {
        team.skills = Object.fromEntries(
          Object.entries(team.skills).filter(([owned]) => owned !== name),
        )
      })
      removed += 1
    } catch (e) {
      console.warn(`local-setup: could not remove ${name}`, e)
    }
  }
  for (const objectKey of plan.deleteKeys) {
    await teamSkillsDeleteObject(teamId, objectKey, 'personal')
  }

  let uploaded = 0

  // One file in memory at a time, SKILL.md first within each skill (the planner
  // keeps localSkillEntries' order), so a partial pass still leaves listable skills.
  for (const upload of plan.uploads) {
    const entry = entries.get(upload.name)?.get(upload.file.relPath)

    if (failed.has(upload.name) || !entry) continue
    try {
      await uploadFile(teamId, key, upload, entry)
      uploaded += 1
    } catch (e) {
      console.warn(`local-setup: could not upload ${upload.key}`, e)
      failed.add(upload.name)
      // Nothing of a skill with no recorded file reached the store (a reserved
      // name, say), so it is not ours to keep or delete later.
      updateTeam(key, (team) => {
        if (Object.keys(team.skills[upload.name] ?? {}).length === 0) {
          team.skills = Object.fromEntries(
            Object.entries(team.skills).filter(([owned]) => owned !== upload.name),
          )
        }
      })
    }
  }
  const sources: Record<string, string> = {}

  // A fully synced skill's record is exactly its current files, so deleted ones drop out.
  updateTeam(key, (team) => {
    for (const name of plan.synced) {
      if (failed.has(name)) continue
      const skill = local.find((candidate) => candidate.name === name)

      team.skills[name] = Object.fromEntries(
        (skill?.files ?? []).map((file) => [file.relPath, file.sha256]),
      )
      if (skill) sources[name] = skill.folder
    }
    // A held skill (its folder not readable this pass) keeps its folder for the next.
    const held = Object.entries(team.sources ?? {}).filter(([name]) => name in team.skills)

    team.sources = { ...Object.fromEntries(held), ...sources }
  })

  const instruction = await syncInstruction(teamId, key)
  const result: LocalSetupResult = {
    at: new Date().toISOString(),
    syncedSkills: plan.synced.length - failed.size,
    uploadedFiles: uploaded,
    removedSkills: removed,
    skipped: [...plan.skipped, ...snapshot.clashes],
    failed: [...failed].toSorted((a, b) => a.localeCompare(b)),
    ...instruction,
    sources,
  }

  updateTeam(key, (team) => {
    team.last = result
  })

  return result
}

/** One pass per team at a time; a second request joins the one in flight. */
export function syncLocalSetup(teamId: string): Promise<LocalSetupResult> {
  const inFlight = running.get(teamId)

  if (inFlight) return inFlight
  const pass = runSync(teamId).finally(() => running.delete(teamId))

  running.set(teamId, pass)

  return pass
}

/** A pass that starts after the one in flight, so it sees what changed since that began. */
export async function syncLocalSetupAfter(teamId: string): Promise<LocalSetupResult> {
  await running.get(teamId)?.catch(() => undefined)

  return syncLocalSetup(teamId)
}

export async function localSetupStatus(teamId: string): Promise<LocalSetupStatus> {
  const team = readTeam(await stateKey(teamId))
  const folders = syncFolders(team)
  const { skills, clashes } = await skillsOfFolders(folders)

  return {
    autoSync: team.autoSync,
    running: running.has(teamId),
    folders: folders.map((folder) => ({
      path: folder,
      skills: skills.filter(inFolder(folder)).length + clashes.filter(inFolder(folder)).length,
    })),
    codexFolder: codexSkillsDir(),
    linkedSkills: skills
      .filter((skill) => outsideFiles(skill).length > 0)
      .map((skill) => ({
        name: skill.name,
        files: skill.files,
        reviewed: linksReviewed(skill, team.approvedLinks ?? {}),
      })),
    claudeMdChars: (await readClaudeMd())?.trim().length ?? null,
    last: team.last,
    budget: { files: RUNTIME_FILE_BUDGET, bytes: RUNTIME_BYTE_BUDGET },
  }
}
