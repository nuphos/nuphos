import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { deriveControlKey, openabConfigToml, openabEnv } from './config.ts'

import type { LocalRuntimeLaunch } from './config.ts'
import type { ChildProcess } from 'node:child_process'

export type RunningRuntime = {
  port: number
  authKey: string
  controlKey: string
}

export type OpenabProcessOptions = Omit<LocalRuntimeLaunch, 'port' | 'authKey'> & {
  logDir: string
}

const READY_TIMEOUT_MS = 20_000
const STOP_GRACE_MS = 5_000

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0

      server.close(() => {
        resolve(port)
      })
    })
  })
}

async function waitUntilListening(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`openab exited during startup (code ${String(child.exitCode)})`)
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
        signal: AbortSignal.timeout(1_000),
      })

      if (response.status < 500) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('openab did not start listening in time')
}

type ProcessEntry = { pid: number; args: string }

function listProcesses(): ProcessEntry[] {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => /^\s*(\d+) (.*)$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => ({ pid: Number(match[1]), args: match[2] ?? '' }))
  } catch {
    return []
  }
}

/** Sends `sig` if the process still exists; signal 0 only asks whether it does. */
function signal(pid: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, sig)

    return true
  } catch {
    return false
  }
}

const alive = (pid: number) => signal(pid, 0)

/**
 * A host that died without stopping openab (a crash, SIGKILL, the OOM killer) leaves
 * it serving this config, with every agent it spawned. openab reaps its agents on
 * SIGTERM, so the next start stops that earlier run instead of adding another.
 */
export async function stopStaleOpenab(
  configPath: string,
  list: () => ProcessEntry[] = listProcesses,
): Promise<void> {
  if (process.platform === 'win32') return
  const stale = list()
    .filter(({ pid, args }) => pid !== process.pid && args.endsWith(`openab run -c ${configPath}`))
    .map(({ pid }) => pid)

  for (const pid of stale) signal(pid, 'SIGTERM')
  const deadline = Date.now() + STOP_GRACE_MS

  while (stale.some(alive) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100))
  for (const pid of stale) signal(pid, 'SIGKILL')
}

/** One openab + adapter process tree on a fresh loopback port and a fresh key. */
export class OpenabProcess {
  private child: ChildProcess | undefined
  private exitListeners = new Set<(code: number | null) => void>()

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener)

    return () => this.exitListeners.delete(listener)
  }

  async start(options: OpenabProcessOptions): Promise<RunningRuntime> {
    await this.stop()
    const port = await freeLoopbackPort()
    const authKey = randomBytes(32).toString('hex')
    const launch: LocalRuntimeLaunch = { ...options, port, authKey }
    const configPath = path.join(options.logDir, 'openab.toml')

    await stopStaleOpenab(configPath)
    for (const dir of [options.logDir, options.workspace, options.openabHome])
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(configPath, openabConfigToml(launch), { mode: 0o600 })
    const log = createWriteStream(path.join(options.logDir, 'openab.log'), { flags: 'a' })

    log.write(`\n=== ${new Date().toISOString()} openab on 127.0.0.1:${String(port)} ===\n`)
    const child = spawn(options.bundle.openab, ['run', '-c', configPath], {
      env: openabEnv(launch),
      cwd: options.workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child = child
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    child.once('exit', (code, signal) => {
      log.end(`=== openab exited code=${String(code)} signal=${String(signal)} ===\n`)
      if (this.child !== child) return
      this.child = undefined
      for (const listener of this.exitListeners) listener(code)
    })
    child.once('error', (error) => {
      log.write(`=== openab failed to start: ${error.message} ===\n`)
    })
    try {
      await waitUntilListening(port, child)
    } catch (error) {
      await this.stop()
      throw error
    }

    return { port, authKey, controlKey: deriveControlKey(authKey) }
  }

  running(): boolean {
    return this.child !== undefined
  }

  stop(): Promise<void> {
    const child = this.child

    this.child = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, STOP_GRACE_MS)

      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  /** Synchronous last resort for process exit, when nothing can be awaited. */
  kill(): void {
    this.child?.kill('SIGKILL')
    this.child = undefined
  }
}
