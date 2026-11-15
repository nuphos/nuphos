// Child processes for the end-to-end run: each one logs to a file in the run's
// artifact directory and is stopped, newest first, when the run ends.
import { spawn as spawnChild } from 'node:child_process'
import { createWriteStream, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChildProcess } from 'node:child_process'

export const artifacts = process.env.E2E_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'nuphos-e2e-'))
const children: ChildProcess[] = []

export function logPath(name: string): string {
  return join(artifacts, `${name}.log`)
}

/** Distinct free ports. They are held open together, or the system can hand out the same one twice. */
export async function freePorts(count: number): Promise<number[]> {
  const servers = Array.from({ length: count }, () => createServer())

  await Promise.all(
    servers.map((server) => new Promise<void>((done) => server.listen(0, '127.0.0.1', done))),
  )
  const ports = servers.map((server) => (server.address() as { port: number }).port)

  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))))

  return ports
}

export async function until(label: string, check: () => Promise<unknown>, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}; logs are in ${artifacts}`)
}

type SpawnOptions = { cwd?: string; env?: Record<string, string> }

/** Little of this computer's environment is inherited, so none of its credentials reach the stack. */
export function spawn(name: string, command: string[], options: SpawnOptions = {}): ChildProcess {
  const log = createWriteStream(logPath(name), { flags: 'a' })
  const inherited = Object.fromEntries(
    ['PATH', 'HOME', 'LD_LIBRARY_PATH', 'DISPLAY', 'XAUTHORITY', 'DOCKER_HOST'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  )
  const child = spawnChild(command[0], command.slice(1), {
    cwd: options.cwd ?? artifacts,
    env: { ...inherited, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it also stops what it started (vite starts Electron).
    detached: true,
  })

  child.stdout.pipe(log)
  child.stderr.pipe(log)
  child.on('error', (error) => log.write(`spawn failed: ${error.message}\n`))
  children.push(child)

  return child
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals | 0): boolean {
  try {
    return process.kill(-child.pid!, signal)
  } catch {
    return false
  }
}

export async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || !signalGroup(child, 'SIGTERM')) return
  const deadline = Date.now() + 5_000

  // Signal 0 only asks whether any process in the group is still alive.
  while (Date.now() < deadline && signalGroup(child, 0)) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  signalGroup(child, 'SIGKILL')
}

export async function stopAll(): Promise<void> {
  for (const child of children.toReversed()) await stop(child)
}
