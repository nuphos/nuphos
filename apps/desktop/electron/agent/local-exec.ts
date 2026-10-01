import { spawn } from 'node:child_process'

import { localExecShell } from '../localExecShell.ts'
import { resolveShellEnv } from '../shell-env.ts'

import type { ChildProcess } from 'node:child_process'

export const DEFAULT_UNIX_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

export function logLocalTool(message: string, data?: Record<string, unknown>) {
  const suffix = data ? ` ${JSON.stringify(data)}` : ''

  try {
    console.log(`[local-tool] ${message}${suffix}`)
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EPIPE') return
    throw err
  }
}

async function localExecEnv(): Promise<NodeJS.ProcessEnv> {
  // Overlay the user's interactive-shell environment: the Electron process
  // itself only has launchd's minimal PATH when launched from Dock/Finder.
  const env = { ...process.env, ...(await resolveShellEnv()) }

  if (process.platform !== 'win32') env.PATH ||= DEFAULT_UNIX_PATH

  return env
}

// Abort hooks for in-flight local commands, keyed by agent session. Lets a
// user Stop kill the command (and its whole process tree) instead of waiting
// out the timeout.
const runningLocalCommandAborts = new Map<string, Set<() => void>>()

export const LOCAL_EXEC_OUTPUT_CAP = 1024 * 1024

// Grace between "the deadline fired, we asked the tree to die" and answering
// anyway. A tree that ignores SIGTERM+SIGKILL (or a spawn that never happened)
// must not hold the promise open: the renderer parks the whole turn on this
// call and has no watchdog of its own while a client tool runs.
const LOCAL_EXEC_FORCE_SETTLE_MS = 5_000

export function normalizeToolError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function runLocalCommand(
  command: string,
  opts: { timeoutMs?: number; sessionId?: string } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeoutMs = 30_000, sessionId } = opts
  const [shell, flag] = localExecShell()

  let resolveResult!: (result: { stdout: string; stderr: string; exitCode: number }) => void
  const result = new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    resolveResult = resolve
  })

  let child: ChildProcess | undefined
  let stdout = ''
  let stderr = ''
  let settled = false
  let exitNote = ''
  let unregister = () => {}
  let forceSettleTimer: ReturnType<typeof setTimeout> | undefined

  const settle = (exitCode: number) => {
    if (settled) return
    settled = true
    clearTimeout(deadline)
    // The tree died inside the force-settle window; don't leave the timer
    // pending just because its guard would have no-opped.
    if (forceSettleTimer) clearTimeout(forceSettleTimer)
    unregister()
    // Tear down our read ends of the pipes: when a backgrounded grandchild
    // keeps them inherited, `close` never fires and the handles would leak
    // in the main process for as long as the grandchild lives.
    child?.stdout?.removeAllListeners('data')
    child?.stderr?.removeAllListeners('data')
    child?.stdout?.destroy()
    child?.stderr?.destroy()
    const extra = exitNote ? (stderr && !stderr.endsWith('\n') ? '\n' : '') + exitNote : ''

    resolveResult({ stdout, stderr: stderr + extra, exitCode })
  }

  const killTree = (signal: NodeJS.Signals) => {
    if (child?.pid == null) return
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows'

      spawn(`${systemRoot}\\System32\\taskkill.exe`, ['/pid', String(child.pid), '/T', '/F']).on(
        'error',
        () => {},
      )

      return
    }
    try {
      process.kill(-child.pid, signal)
    } catch {
      try {
        child.kill(signal)
      } catch {
        // Already gone.
      }
    }
  }

  const killWithNote = (note: string) => {
    if (settled) return
    if (!exitNote) exitNote = note
    killTree('SIGTERM')
    setTimeout(() => {
      if (!settled) killTree('SIGKILL')
    }, 2_000).unref()
    // Deliberately not unref'd: this timer IS the answer when the tree refuses
    // to die (or never spawned), so it must not be droppable.
    forceSettleTimer = setTimeout(() => settle(124), LOCAL_EXEC_FORCE_SETTLE_MS)
  }

  // One deadline over EVERY phase — the login-shell env probe, the spawn, and
  // the wait for exit. Arming it before the env await matters: that await used
  // to sit outside any timer, so a probe that never resolved hung the tool (and
  // the turn) forever.
  const deadline = setTimeout(
    () =>
      killWithNote(
        `local_exec: command timed out after ${String(Math.round(timeoutMs / 1000))}s and was killed`,
      ),
    timeoutMs,
  )

  // Registered before the env await: the first resolveShellEnv probe can take
  // seconds, and a Stop landing in that window must prevent the spawn entirely,
  // not orphan it.
  let onAbort = () => {
    exitNote = 'local_exec: command stopped by user'
    settle(124)
  }
  const abort = () => onAbort()

  if (sessionId) {
    let aborts = runningLocalCommandAborts.get(sessionId)

    if (!aborts) {
      aborts = new Set()
      runningLocalCommandAborts.set(sessionId, aborts)
    }
    aborts.add(abort)
    const registered = aborts

    unregister = () => {
      registered.delete(abort)
      if (registered.size === 0) runningLocalCommandAborts.delete(sessionId)
    }
  }

  void (async () => {
    let env: NodeJS.ProcessEnv

    try {
      env = await localExecEnv()
    } catch (err) {
      exitNote = `local_exec: could not resolve the shell environment (${normalizeToolError(err)})`
      settle(1)

      return
    }
    // A Stop or the deadline already answered while the probe ran.
    if (settled) return

    child = spawn(shell, [flag, command], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group on POSIX so kills reach the whole tree, not just the
      // shell. Windows has no process groups; killTree uses `taskkill /T`.
      detached: process.platform !== 'win32',
    })
    onAbort = () => killWithNote('local_exec: command stopped by user')

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < LOCAL_EXEC_OUTPUT_CAP) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < LOCAL_EXEC_OUTPUT_CAP) stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (!exitNote) exitNote = err.message
      settle(1)
    })
    // Settle on `exit`, not `close`: `close` waits for the stdio pipes, which
    // a backgrounded grandchild can hold open forever, leaving the tool stuck
    // in "running". Give the pipes a moment to flush trailing output, then
    // resolve with whatever arrived.
    child.on('exit', (code, signal) => {
      const exitCode = typeof code === 'number' ? code : signal ? 124 : 1
      const grace = setTimeout(() => settle(exitCode), 1_000)

      grace.unref()
      child?.once('close', () => {
        clearTimeout(grace)
        settle(exitCode)
      })
    })
  })()

  return result
}

/**
 * Stop every in-flight client-side local tool for a session: kill running
 * local commands (whole process tree) and deny approval dialogs still waiting
 * on the user. Leaving an approval pending would also poison the next
 * identical command via the pendingLocalExecApprovals dedupe.
 */
export function abortClientTools(sessionId: string): void {
  const aborts = runningLocalCommandAborts.get(sessionId)

  if (aborts) {
    for (const abort of aborts) abort()
  }
  logLocalTool('aborted client tools', { sessionId })
}
