// One launcher per instance key, and a record of what it owns for `dev:instances`.
// The lease is a loopback listener the OS releases on exit, including crashes,
// so no stale lock can admit two launchers for one key.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { connect, createServer } from 'node:net'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'

import { mainRoot } from './dev-workspace.ts'

export type InstanceRecord = {
  key: string
  root: string
  /** The live launcher; null once it quit. */
  pid: number | null
  backend: number | null
  vite: number | null
  cdp: number | null
  appData: string
  cliConfig: string
  logDir: string
  /** Process groups the launcher spawned, reaped by `rm` if it died without doing so. */
  groups: number[]
}

const DIR = join(homedir(), '.cache', 'nuphos-dev', 'instances')

function leasePort(key: string): number {
  const hash = createHash('sha256').update(key).digest('hex')

  return 49_152 + (Number.parseInt(hash.slice(0, 8), 16) % 15_000)
}

const leaseIdentity = (key: string) => `nuphos-dev:${key}`

async function leaseOwner(port: number): Promise<string> {
  return new Promise((resolve) => {
    const client = connect({ host: '127.0.0.1', port })
    let reply = ''
    const finish = () => {
      client.destroy()
      resolve(reply.trim())
    }

    client.setTimeout(500, finish)
    client.on('error', finish)
    client.on('end', finish)
    client.on('data', (chunk: Buffer) => {
      reply += chunk.toString()
      if (reply.includes('\n') || reply.length > 200) finish()
    })
  })
}

export async function instanceRunning(key: string): Promise<boolean> {
  return (await leaseOwner(leasePort(key))) === leaseIdentity(key)
}

export async function acquireDevInstance(key: string): Promise<() => void> {
  const port = leasePort(key)
  const server = createServer((client) => client.end(`${leaseIdentity(key)}\n`))

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    server.unref()

    return () => server.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    if ((await leaseOwner(port)) === leaseIdentity(key))
      throw new Error(
        `Dev instance "${key}" is already running. Use its Electron window, or set NUPHOS_DEV_INSTANCE=<another name> to start a second one.`,
        { cause: error },
      )
    // Fail closed on a collision. Picking a second port could admit a duplicate
    // later if the unrelated listener on the first port disappears.
    throw new Error(
      `Dev instance lease port ${String(port)} is occupied by another process; set NUPHOS_DEV_INSTANCE to another name.`,
      { cause: error },
    )
  }
}

/** Where Electron keeps the profile of `Nuphos Dev (<suffix>)`. */
export function electronAppData(name: string): string {
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))

  return join(base, name)
}

/** Owner-only and really a directory, so nobody else can plant records in it. */
function privateDir(): boolean {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const stat = lstatSync(DIR)

  return stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0
}

const recordPath = (key: string) => join(DIR, `${key}.json`)

let lastWritten = ''

/** Writes only on change, atomically, so readers never see half a record. */
export function writeInstance(record: InstanceRecord): void {
  const json = JSON.stringify(record, null, 2)

  if (json === lastWritten) return
  try {
    if (!privateDir()) return
    const tmp = `${recordPath(record.key)}.${String(process.pid)}.tmp`

    writeFileSync(tmp, json, { mode: 0o600 })
    renameSync(tmp, recordPath(record.key))
    lastWritten = json
  } catch {
    // Only `dev:instances` reads it; the launcher runs fine without.
  }
}

export function readInstances(): InstanceRecord[] {
  try {
    if (!privateDir()) return []

    return readdirSync(DIR)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        try {
          return [JSON.parse(readFileSync(join(DIR, name), 'utf8')) as InstanceRecord]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** Live launchers besides `self`: whoever still uses the shared stack. */
export function liveLaunchers(
  records: readonly InstanceRecord[],
  self: number,
  isAlive: (pid: number) => boolean,
): number {
  return records.filter((r) => r.pid !== null && r.pid !== self && isAlive(r.pid)).length
}

export function otherLaunchers(): number {
  return liveLaunchers(readInstances(), process.pid, processIsAlive)
}

/** The directory a process runs in; null when it cannot be read. */
function processCwd(pid: number): string | null {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()

    return (
      out
        .split('\n')
        .find((line) => line.startsWith('n'))
        ?.slice(1) ?? null
    )
  } catch {
    return null
  }
}

const within = (path: string, root: string) => path === root || path.startsWith(root + sep)

function sizeKb(path: string): number {
  if (!existsSync(path)) return 0
  const out = spawnSync('du', ['-sk', path], { encoding: 'utf8' }).stdout ?? ''

  return Number(out.split(/\s/)[0]) || 0
}

const isLinkedWorktree = (root: string) => existsSync(root) && mainRoot(root) !== root

/** Disk the instance would free: its linked worktree (node_modules included) and Desktop profile. */
export function instanceDiskKb(record: InstanceRecord): number {
  return (isLinkedWorktree(record.root) ? sizeKb(record.root) : 0) + sizeKb(record.appData)
}

export function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`

  return `${String(Math.round(kb / 1024))}M`
}

async function stopLauncher(record: InstanceRecord, log: (line: string) => void): Promise<void> {
  if (!record.pid || !(await instanceRunning(record.key))) return
  log(`stopping launcher ${String(record.pid)} …`)
  process.kill(record.pid, 'SIGTERM')
  for (let waited = 0; waited < 30_000; waited += 500) {
    if (!(await instanceRunning(record.key))) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`launcher ${String(record.pid)} did not stop; quit it with q and retry`)
}

function reapLeftovers(record: InstanceRecord, log: (line: string) => void): void {
  for (const group of record.groups) {
    const cwd = processIsAlive(group) ? processCwd(group) : null

    if (cwd && within(cwd, record.root)) {
      log(`killing leftover process group ${String(group)}`)
      try {
        process.kill(-group, 'SIGKILL')
      } catch {
        /* gone */
      }
    }
  }
}

/** Stops the instance's own launcher, then deletes its profile, sign-in, logs and worktree. */
export async function removeInstance(key: string, log: (line: string) => void): Promise<void> {
  const record = readInstances().find((r) => r.key === key)

  if (!record) throw new Error(`no dev instance "${key}"; see bun run dev:instances`)
  await stopLauncher(record, log)
  const sharedRoot = readInstances().some(
    (r) => r.key !== key && r.root === record.root && r.pid !== null && processIsAlive(r.pid),
  )

  // A launcher killed with SIGKILL leaves its children behind. Reap only groups
  // whose leader still runs inside this worktree, and not while another live
  // instance runs there too, since a reused pid could then be one of its own.
  if (!sharedRoot) reapLeftovers(record, log)
  rmSync(record.appData, { recursive: true, force: true })
  rmSync(record.cliConfig, { force: true })
  rmSync(record.logDir, { recursive: true, force: true })
  log(`removed Desktop profile, sign-in and logs of "${key}"`)

  if (isLinkedWorktree(record.root) && !sharedRoot) {
    // No --force: git refuses when the worktree has uncommitted changes.
    const result = spawnSync('git', ['worktree', 'remove', record.root], {
      cwd: mainRoot(record.root),
      encoding: 'utf8',
    })

    log(
      result.status === 0
        ? `removed worktree ${record.root}`
        : `kept worktree ${record.root}: ${result.stderr.trim()}`,
    )
  }
  rmSync(recordPath(key), { force: true })
}
