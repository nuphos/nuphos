// Keeping "Sync my setup" current: re-run it for every team with "Keep in sync"
// on whenever ~/.claude/skills or ~/.claude/CLAUDE.md changes.
import fsSync from 'node:fs'
import path from 'node:path'

import { removeRetiredAgentChatSkills } from '../agent-chat-skill.ts'
import { readConfig } from '../auth/config.ts'

import { claudeDir, readTeam, stateKey, teamKeys, updateTeam } from './local-setup-state.ts'
import { syncLocalSetup } from './local-setup-sync.ts'

export async function setLocalSetupAutoSync(teamId: string, enabled: boolean) {
  updateTeam(await stateKey(teamId), (team) => {
    team.autoSync = enabled
  })
  if (enabled) {
    startLocalSetupWatcher()
    void syncLocalSetup(teamId).catch((e: unknown) => {
      console.warn('local-setup: sync failed', e)
    })
  }
}

const DEBOUNCE_MS = 5_000
const PERIODIC_MS = 30 * 60_000
let watchers: fsSync.FSWatcher[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let periodic: ReturnType<typeof setInterval> | null = null

async function autoSyncTeams(): Promise<string[]> {
  const userId = (await readConfig()).userInfo?.id

  if (!userId) return []

  return teamKeys()
    .filter((key) => key.startsWith(`${userId}:`) && readTeam(key).autoSync)
    .map((key) => key.slice(userId.length + 1))
}

function syncAutoTeams() {
  void autoSyncTeams().then(
    (teamIds) => {
      for (const teamId of teamIds) {
        syncLocalSetup(teamId).catch((e: unknown) => {
          console.warn('local-setup: sync failed', e)
        })
      }
    },
    (e: unknown) => {
      // The sign-in could not be read (a locked keychain): the next tick tries again.
      console.warn('local-setup: sync failed', e)
    },
  )
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    syncAutoTeams()
  }, DEBOUNCE_MS)
}

function watch(dir: string, options: fsSync.WatchOptions, accept: (file: string) => boolean) {
  try {
    const watcher = fsSync.watch(dir, options, (_event, file) => {
      if (file && accept(String(file))) schedule()
    })

    watcher.on('error', () => watcher.close())
    watchers.push(watcher)
  } catch {
    // The directory does not exist yet; the periodic pass still picks it up.
  }
}

/**
 * Re-sync every team with "Keep in sync" on whenever ~/.claude/skills or
 * ~/.claude/CLAUDE.md changes, plus every half hour and once at start-up for
 * anything missed while Nuphos was closed. Idempotent.
 */
export function startLocalSetupWatcher() {
  if (periodic) return
  const root = claudeDir()

  watch(path.join(root, 'skills'), { recursive: true }, () => true)
  watch(root, {}, (file) => file === 'CLAUDE.md')
  periodic = setInterval(syncAutoTeams, PERIODIC_MS)
  schedule()
}

/** At start-up: watch only when some team has "Keep in sync" on. */
export function resumeLocalSetupSync() {
  // A skill Desktop no longer ships is removed from the agents' folders on every start.
  void removeRetiredAgentChatSkills().catch(() => undefined)
  if (teamKeys().some((key) => readTeam(key).autoSync)) startLocalSetupWatcher()
}

export function stopLocalSetupWatcher() {
  for (const watcher of watchers) watcher.close()
  watchers = []
  if (timer) clearTimeout(timer)
  if (periodic) clearInterval(periodic)
  timer = null
  periodic = null
}
