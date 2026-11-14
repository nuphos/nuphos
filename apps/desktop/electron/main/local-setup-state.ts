// What "Sync my setup" remembers on this computer, per signed-in member and team:
// the skills and Instructions it put in Nuphos and whether to keep them in sync.
// Every change goes through updateTeam on one in-memory copy that is written to
// disk at once, so concurrent passes for different teams, a "Keep in sync"
// toggle mid-pass, and a pass that fails half-way never lose each other's records.
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { readConfig } from '../auth/config.ts'

import type { SkippedSkill } from './local-setup-plan.ts'
import type { LocalSkillFileInfo } from './local-skills.ts'

export type LocalSetupResult = {
  at: string
  syncedSkills: number
  uploadedFiles: number
  removedSkills: number
  skipped: SkippedSkill[]
  instruction: 'synced' | 'removed' | 'none' | 'too_long'
  instructionParts: number
  /** Skills whose upload the store refused, e.g. a reserved name. */
  failed: string[]
  /** The folder each synced skill came from. */
  sources?: Record<string, string>
}

export type LocalSetupStatus = {
  autoSync: boolean
  running: boolean
  /** The folders synced, ~/.claude/skills first: a name in two goes from the first. */
  folders: { path: string; skills: number }[]
  /** Where Codex keeps its skills, offered as a folder to add. */
  codexFolder: string
  /** Skills linking outside their own folder: sync reads one only once reviewed. */
  linkedSkills: { name: string; files: LocalSkillFileInfo[]; reviewed: boolean }[]
  claudeMdChars: number | null
  last: LocalSetupResult | null
  budget: { files: number; bytes: number }
}

export type TeamState = {
  autoSync: boolean
  /**
   * Skills this computer owns in the personal store: relPath → sha256 of the
   * content last uploaded. A skill is claimed here before its first upload, so
   * a pass that stops part-way still recognises it as its own.
   */
  skills: Record<string, Record<string, string>>
  /** Instruction ids in part order, recorded the moment each is created. */
  instructionIds: string[]
  last: LocalSetupResult | null
  /** Links out of a skill the member reviewed: skill → relPath → realPath. */
  approvedLinks?: ApprovedLinks
  /** Folders synced after ~/.claude/skills, in order: Codex's, or any the member added. */
  folders?: string[]
  /** The folder each synced skill came from, as of the last pass. */
  sources?: Record<string, string>
}

export type ApprovedLinks = Record<string, Record<string, string> | undefined>

export type FileHash = {
  size: number
  mtimeMs: number
  /** Where a linked file resolved to: Nix store files all share one mtime. */
  realPath?: string
  /** What reading it returned, when that differs from `size` (procfs reports 0). */
  bytes?: number
  sha256: string
}
export type HashCache = Record<string, FileHash>

type State = { teams: Record<string, TeamState> }

export function claudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

/** Every folder a team syncs skills from, in order: ~/.claude/skills, then the member's. */
export function syncFolders(team: TeamState): string[] {
  return [path.join(claudeDir(), 'skills'), ...(team.folders ?? [])]
}

function dataFile(name: string): string {
  return path.join(app.getPath('userData'), name)
}

function readJson<T>(name: string): Partial<T> {
  try {
    return JSON.parse(fsSync.readFileSync(dataFile(name), 'utf8')) as Partial<T>
  } catch {
    return {}
  }
}

/** Write to a temporary file and rename it over the old one, so a crash never leaves half a file. */
function writeJson(name: string, value: unknown) {
  const file = dataFile(name)
  const temporary = `${file}.${String(process.pid)}.tmp`

  try {
    fsSync.writeFileSync(temporary, JSON.stringify(value), 'utf8')
    fsSync.renameSync(temporary, file)
  } catch (e) {
    console.warn(`local-setup: could not save ${name}`, e)
  }
}

const STATE_FILE = 'local-setup-sync.json'
const HASHES_FILE = 'local-setup-hashes.json'
let state: State | null = null

function current(): State {
  state ??= { teams: readJson<State>(STATE_FILE).teams ?? {} }

  return state
}

function blankTeam(): TeamState {
  return { autoSync: false, skills: {}, instructionIds: [], last: null }
}

/** A copy of one team's record; change it only through updateTeam. */
export function readTeam(key: string): TeamState {
  return structuredClone(current().teams[key] ?? blankTeam())
}

export function teamKeys(): string[] {
  return Object.keys(current().teams)
}

/** Apply one change to one team's record and persist the whole file before returning. */
export function updateTeam(key: string, change: (team: TeamState) => void) {
  const teams = current().teams

  teams[key] ??= blankTeam()
  change(teams[key])
  writeJson(STATE_FILE, current())
}

/** Personal stores are per member, so a different sign-in on this computer starts fresh. */
export async function stateKey(teamId: string): Promise<string> {
  const userId = (await readConfig()).userInfo?.id ?? 'unknown'

  return `${userId}:${teamId}`
}

export function readHashCache(): HashCache {
  return readJson<{ hashes: HashCache }>(HASHES_FILE).hashes ?? {}
}

/**
 * Keep the hashes a pass just saw. Under the `scanned` folders, files the pass
 * did not see are gone and their entries dropped; anything else on disk is kept,
 * so passes for different teams merge rather than overwrite each other.
 */
export function saveHashCache(seen: HashCache, scanned: readonly string[]) {
  const prefixes = scanned.map((dir) => (dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`))
  const kept = Object.fromEntries(
    Object.entries(readHashCache()).filter(
      ([file]) => !prefixes.some((prefix) => file.startsWith(prefix)),
    ),
  )

  writeJson(HASHES_FILE, { hashes: { ...kept, ...seen } })
}

/** Tests only: forget the in-memory copy so the next read comes from disk. */
export function resetStateForTests() {
  state = null
}
