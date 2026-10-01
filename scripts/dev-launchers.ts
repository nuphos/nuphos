// Every running launcher leaves a pid file here, so a quitting one can tell
// whether the shared compose stack and named tunnel are still in use.
import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.cache', 'nuphos-dev', 'launchers')

/** Owner-only and really a directory, so nobody else can plant entries in it. */
function privateDir(): boolean {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const stat = lstatSync(DIR)

  return stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** Live launcher pids other than `self`, and the stale ones to prune. */
export function partitionLaunchers(
  names: readonly string[],
  self: number,
  isAlive: (pid: number) => boolean,
): { others: number[]; stale: number[] } {
  const pids = names.filter((name) => /^\d+$/.test(name)).map(Number)

  return {
    others: pids.filter((pid) => pid !== self && isAlive(pid)),
    stale: pids.filter((pid) => pid !== self && !isAlive(pid)),
  }
}

export function registerLauncher(): () => void {
  const file = join(DIR, String(process.pid))

  try {
    if (!privateDir()) return () => {}
    try {
      unlinkSync(file) // a stale marker from a reused pid
    } catch {
      /* none */
    }
    writeFileSync(file, '', { flag: 'wx', mode: 0o600 })
  } catch {
    return () => {}
  }

  return () => {
    try {
      unlinkSync(file)
    } catch {
      /* already gone */
    }
  }
}

export function otherLaunchers(): number {
  let names: string[]

  try {
    if (!privateDir()) return 0
    names = readdirSync(DIR)
  } catch {
    return 0
  }
  const { others, stale } = partitionLaunchers(names, process.pid, processIsAlive)

  for (const pid of stale) {
    try {
      unlinkSync(join(DIR, String(pid)))
    } catch {
      /* another launcher pruned it */
    }
  }

  return others.length
}
