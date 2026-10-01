// Process-group teardown.
// A detached child is a group leader, so its pid == its pgid; signalling -pid
// hits the parent AND every descendant (bun --hot / vite / electron + helpers).
import { treesToStop } from './dev-quit.ts'
import { services } from './dev-services.ts'

import type { ChildProcess } from 'node:child_process'

// Set the moment a quit starts, so the supervisors stop treating a child's exit
// as a crash worth reporting or retrying.
let quitting = false

export function isQuitting(): boolean {
  return quitting
}

export function markQuitting() {
  quitting = true
}

function signalPgid(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal)

    return true
  } catch {
    return false
  }
}

export function signalGroup(child: ChildProcess | null, signal: NodeJS.Signals) {
  const pid = child?.pid

  if (!pid || child.exitCode !== null) return
  if (signalPgid(pid, signal)) return
  try {
    child.kill(signal) // fall back to the direct process
  } catch {
    /* already gone */
  }
}

export function waitExit(child: ChildProcess | null, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) return resolve()
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      child.off('exit', done)
      resolve()
    }, timeoutMs)

    child.once('exit', done)
  })
}

// The group outlives its leader: `pnpm` exits ahead of vite and Electron, and
// an orphaned Electron keeps its window (and, once our pipe closes, dies on
// EPIPE with a crash dialog). Signal 0 probes the group for any member left.
async function waitGroupGone(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (groupHasMembers(pgid)) {
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 100))
  }

  return true
}

function groupHasMembers(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)

    return true
  } catch {
    return false
  }
}

/** SIGTERM a service tree, wait for the leader AND every descendant, then
 *  SIGKILL whatever is left. Safe on a leader that has already exited. */
export async function stopTree(
  child: ChildProcess | null,
  graceMs = 5000,
): Promise<'stopped' | 'force-killed'> {
  const pid = child?.pid

  if (!pid) return 'stopped'
  signalPgid(pid, 'SIGTERM')
  await waitExit(child, graceMs)
  if (await waitGroupGone(pid, child.exitCode === null ? 0 : 2000)) return 'stopped'
  signalPgid(pid, 'SIGKILL')
  await waitExit(child, 2000)
  await waitGroupGone(pid, 2000)

  return 'force-killed'
}

// SIGTERM each service's group, wait, then SIGKILL any survivor, confirming
// each is gone. `onStopped` fires per service so the caller can show progress
// during the multi-second SIGTERM → SIGKILL window instead of a frozen screen.
export async function stopAllTrees(
  onStopped?: (name: string, how: string) => void,
  graceMs = 5000,
): Promise<void> {
  const names = new Set(treesToStop(services.map((s) => ({ name: s.name, pid: s.proc?.pid }))))
  const started = services.filter((s) => names.has(s.name))

  await Promise.all(
    started.map(async (s) => {
      const how = await stopTree(s.proc, graceMs)

      s.logStream?.end()
      onStopped?.(s.name, how)
    }),
  )
}
