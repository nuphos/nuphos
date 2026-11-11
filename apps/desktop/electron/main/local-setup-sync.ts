// "Sync my setup": mirror this computer's Claude Code skills and ~/.claude/CLAUDE.md
// into the signed-in user's personal skills and personal Instructions for a team,
// so every runtime they use starts with the same context their own CLI has. The
// decisions live in local-setup-plan.ts; this module reads disk and calls the API,
// recording each change in local-setup-state.ts as it lands, and
// local-setup-watch.ts re-runs it when files change.
import { createHash } from 'node:crypto'
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
  updateTeam,
} from './local-setup-state.ts'
import { listLocalSkills, localSkillEntries, readSkillFile } from './local-skills.ts'

import type { LocalSkillSnapshot, RemoteObject } from './local-setup-plan.ts'
import type {
  FileHash,
  HashCache,
  LocalSetupResult,
  LocalSetupStatus,
} from './local-setup-state.ts'
import type { LocalSkillEntry } from './local-skills.ts'

export type { LocalSetupResult, LocalSetupStatus } from './local-setup-state.ts'

async function hashFile(full: string, entry: LocalSkillEntry, cache: HashCache, seen: HashCache) {
  const { realPath, size, mtimeMs } = entry
  const cached = cache[full] as FileHash | undefined
  const sha256 =
    cached?.size === size && cached.mtimeMs === mtimeMs && cached.realPath === realPath
      ? cached.sha256
      : createHash('sha256')
          .update(await readSkillFile(entry))
          .digest('hex')

  seen[full] = { size, mtimeMs, realPath, sha256 }

  return sha256
}

/** Claude Code skills only: Codex keeps its own, and a name can exist under both. */
async function snapshotLocalSkills(cache: HashCache): Promise<{
  skills: (LocalSkillSnapshot & { entries: Map<string, LocalSkillEntry> })[]
  hashes: HashCache
}> {
  const skills = (await listLocalSkills()).filter((skill) => skill.source === 'claude')
  const out: (LocalSkillSnapshot & { entries: Map<string, LocalSkillEntry> })[] = []
  // Only files that still exist keep a cache entry.
  const seen: HashCache = {}

  for (const skill of skills) {
    const entries = await localSkillEntries(skill.path)
    const files = []

    for (const entry of entries) {
      const full = path.join(skill.path, entry.relPath)

      files.push({
        relPath: entry.relPath,
        size: entry.size,
        sha256: await hashFile(full, entry, cache, seen),
      })
    }
    out.push({
      name: skill.name,
      entries: new Map(entries.map((entry) => [entry.relPath, entry])),
      files,
    })
  }

  return { skills: out, hashes: seen }
}

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
  const snapshot = await snapshotLocalSkills(readHashCache())
  const local = snapshot.skills

  saveHashCache(snapshot.hashes, path.join(claudeDir(), 'skills'))
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
  // A fully synced skill's record is exactly its current files, so deleted ones drop out.
  updateTeam(key, (team) => {
    for (const name of plan.synced) {
      if (failed.has(name)) continue
      const files = local.find((skill) => skill.name === name)?.files ?? []

      team.skills[name] = Object.fromEntries(files.map((file) => [file.relPath, file.sha256]))
    }
  })

  const instruction = await syncInstruction(teamId, key)
  const result: LocalSetupResult = {
    at: new Date().toISOString(),
    syncedSkills: plan.synced.length - failed.size,
    uploadedFiles: uploaded,
    removedSkills: removed,
    skipped: plan.skipped,
    failed: [...failed].toSorted((a, b) => a.localeCompare(b)),
    ...instruction,
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

export async function localSetupStatus(teamId: string): Promise<LocalSetupStatus> {
  const team = readTeam(await stateKey(teamId))
  const skills = (await listLocalSkills()).filter((skill) => skill.source === 'claude')

  return {
    autoSync: team.autoSync,
    running: running.has(teamId),
    localSkills: skills.length,
    outsideFiles: skills.flatMap((skill) =>
      skill.files
        .filter((file) => file.outside)
        .map(({ relPath, realPath }) => ({ skill: skill.name, relPath, realPath })),
    ),
    claudeMdChars: (await readClaudeMd())?.trim().length ?? null,
    last: team.last,
    budget: { files: RUNTIME_FILE_BUDGET, bytes: RUNTIME_BYTE_BUDGET },
  }
}
