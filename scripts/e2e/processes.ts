// Child processes for the end-to-end run: each one logs to a file in the run's
// artifact directory and is stopped, newest first, when the run ends.
import { spawn as spawnChild } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { createWriteStream, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChildProcess } from 'node:child_process'
import type { Server } from 'node:net'

export const artifacts = process.env.E2E_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'nuphos-e2e-'))
const children: ChildProcess[] = []

export function logPath(name: string): string {
  return join(artifacts, `${name}.log`)
}

// Distinct free ports below the ephemeral range (Linux 32768+, macOS 49152+), where an outbound
// connection could take one as its source port first. None is handed out twice in a run: a
// port from an earlier call may not be bound yet when the next call asks (#4394).
const given = new Set<number>()

export async function freePorts(count: number): Promise<number[]> {
  const servers: Server[] = []

  while (servers.length < count) {
    const port = randomInt(20_000, 32_000)

    if (given.has(port)) continue
    const server = createServer()
    const listening = await new Promise<boolean>((done) => {
      server.once('error', () => done(false))
      server.listen(port, '127.0.0.1', () => done(true))
    })

    if (listening) servers.push(server)
  }
  const ports = servers.map((server) => (server.address() as { port: number }).port)

  for (const port of ports) given.add(port)

  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))))

  return ports
}

// Retries `check` until it is truthy. It may throw while what it waits for is starting;
// a timeout reports the error of its last attempt, if that attempt threw.
export async function until(label: string, check: () => Promise<unknown>, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let failure: unknown

  while (Date.now() < deadline) {
    failure = undefined
    const passed = await check().then(Boolean, (error: unknown) => {
      failure = error

      return false
    })

    if (passed) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const last = failure instanceof Error ? ` (last error: ${failure.message})` : ''

  throw new Error(`Timed out waiting for ${label}${last}; logs are in ${artifacts}`)
}

type SpawnOptions = { cwd?: string; env?: Record<string, string> }

/** Little of this computer's environment is inherited, so none of its credentials reach the stack. */
export function spawn(name: string, command: string[], options: SpawnOptions = {}): ChildProcess {
  const log = createWriteStream(logPath(name), { flags: 'a' })
  const inherited = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'LD_LIBRARY_PATH',
      'DISPLAY',
      'XAUTHORITY',
      'DOCKER_HOST',
      'OPENAB_ACP_STREAMING',
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
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

export function signalGroup(child: ChildProcess, signal: NodeJS.Signals | 0): boolean {
  try {
    return process.kill(-child.pid!, signal)
  } catch {
    return false
  }
}

/** Stops the process group, runs `whileFrozen`, then lets it go on, so whatever it serves waits. */
export async function frozen(child: ChildProcess, whileFrozen: () => Promise<void>): Promise<void> {
  signalGroup(child, 'SIGSTOP')
  await whileFrozen().finally(() => signalGroup(child, 'SIGCONT'))
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

// All at once: each may take its full 5 s, and one after another a stack took 37 s to stop.
export async function stopAll(): Promise<void> {
  await Promise.all(children.map(stop))
}

// An interrupted run stops what it started, and only that: each child is its own process group, so
// without this a signalled runner leaves its database and agents running.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stopAll().finally(() => process.exit(1))
  })
}

/** The newest six-digit sign-in code the backend logged for this address. */
export function signInCode(address: string): string | undefined {
  return readFileSync(logPath('backend'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(address) && line.includes('auth.email_otp.dev_code'))
    .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/.exec(line)?.[1])
    .findLast(Boolean)
}
