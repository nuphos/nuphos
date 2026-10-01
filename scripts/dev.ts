#!/usr/bin/env bun

// nuphos dev — the local docker compose stack, the backend with hot reload, and Desktop (default)
// or Admin (`--admin`) behind a live dashboard; `--managed` adds managed agents on local k8s.
import { startAdmin } from './dev-admin.ts'
import { ensureBackendEnv, resetBackendRetries, startBackend } from './dev-backend.ts'
import { BOLD, DIM, GREEN, RESET, enterAltScreen, leaveAltScreen, render } from './dev-dashboard.ts'
import { startDesktop } from './dev-desktop.ts'
import { consumeDirty, markDirty, pushEvent, TTY } from './dev-event-log.ts'
import { acquireDevInstance } from './dev-instance.ts'
import { otherLaunchers, registerLauncher } from './dev-launchers.ts'
import { startLocalAgent } from './dev-local-agent.ts'
import { isLocalContextName } from './dev-managed-env.ts'
import { startManagedAgents } from './dev-managed.ts'
import { DEV_OPTIONS } from './dev-options.ts'
import { releaseAllPorts } from './dev-ports.ts'
import { OPEN_MENU, menuKey, quitPlan, quitSummary, quitMenuView } from './dev-quit.ts'
import { acquireResetLock, resetInProgress, resetMessage, runReset } from './dev-reset.ts'
import { copyRuntimePassword, startLocalRuntime } from './dev-runtime.ts'
import { backend, localAgent, services } from './dev-services.ts'
import { isQuitting, markQuitting, stopAllTrees, stopTree } from './dev-shutdown.ts'
import { compose, startStack, stopStack } from './dev-stack.ts'
import { checkStalls } from './dev-stall-watchdog.ts'
import { stopOwnNamedTunnel, stopTunnel, tunnel, tunnelOwnership } from './dev-tunnel.ts'
import { ROOT, WT_ID } from './dev-workspace.ts'

import type { QuitChoice } from './dev-quit.ts'

let releaseInstance = () => {}
let unregisterLauncher = () => {}

const startFrontend = DEV_OPTIONS.mode === 'admin' ? startAdmin : startDesktop

async function quit(code = 0, choice: QuitChoice = 'processes'): Promise<void> {
  if (isQuitting()) return
  markQuitting()
  quitMenuView.menu = null
  for (const s of services) s.status = 'stopped'
  // Leave the alt screen first so the teardown progress prints on the real
  // terminal (and survives after exit) instead of vanishing with the TUI.
  leaveAltScreen()
  unregisterLauncher()
  const facts = { otherLaunchers: otherLaunchers(), tunnel: tunnelOwnership() }
  let plan = quitPlan(choice, facts)

  stopTunnel()
  if (plan.killTunnel) stopOwnNamedTunnel()
  process.stdout.write(`\n  ${BOLD}▲ nuphos dev${RESET} ${DIM}shutting down…${RESET}\n`)
  const stopped: string[] = []

  await stopAllTrees((name, how) => {
    stopped.push(name)
    process.stdout.write(`  ${DIM}·${RESET} ${name.padEnd(8)} ${how}\n`)
  })
  releaseAllPorts()
  if (plan.compose !== 'keep') {
    const mode = plan.compose

    process.stdout.write(
      `  ${DIM}·${RESET} docker compose ${mode === 'down' ? 'down -v' : 'stop'}…\n`,
    )
    // Launchers are counted again under the reset lock: one may have started during teardown.
    const result = await runReset({
      confirm: () => Promise.resolve(true),
      acquire: () => acquireResetLock(),
      otherLaunchers,
      wipe: () => stopStack(mode, (line) => process.stdout.write(`    ${DIM}${line}${RESET}\n`)),
    })

    if (result.outcome === 'in-use')
      plan = { ...plan, compose: 'keep', composeHeldBy: result.others }
    else if (result.outcome !== 'wiped')
      process.stdout.write(
        `  ${resetMessage(result)} Run: bun run ${mode === 'down' ? 'dev:reset' : 'dev:stop'}\n`,
      )
  }
  process.stdout.write('\n')
  for (const line of quitSummary(stopped, plan, facts)) process.stdout.write(`  ${line}\n`)
  process.stdout.write(`  ${GREEN}✓${RESET} bye.\n`)
  process.exit(code)
}

async function resetStack() {
  pushEvent(compose, '--reset: wiping the local stack …')
  const result = await runReset({
    confirm: () => Promise.resolve(true),
    acquire: () => acquireResetLock(),
    otherLaunchers,
    wipe: () => stopStack('down', (line) => pushEvent(compose, line)),
  })

  pushEvent(compose, `--reset: ${resetMessage(result)}`)
}

/** A launcher registers before looking, and a reset locks before counting, so one of them always sees the other. */
async function waitForReset() {
  if (!(await resetInProgress())) return
  process.stdout.write('  waiting for bun run dev:reset to finish …\n')
  while (await resetInProgress()) await new Promise((resolve) => setTimeout(resolve, 500))
}

// The stack stays up across restarts and quits; `up` on a running stack is a no-op.
async function startAll() {
  if (DEV_OPTIONS.mode === 'desktop') void startLocalAgent()
  const { managed } = DEV_OPTIONS
  const managedReady = managed ? startManagedAgents(managed) : Promise.resolve(false)
  const local = await startStack()

  if (!local) return
  await startBackend(local, managed && (await managedReady) ? managed : null)
  void startLocalRuntime(local)
  await startFrontend()
}

async function restartAll() {
  resetBackendRetries()
  pushEvent(backend, 'restart requested — stopping trees…')
  await Promise.all(services.filter((s) => s !== localAgent).map((s) => stopTree(s.proc, 4000)))
  await startAll()
}

function bindKeys() {
  const stdin = process.stdin

  if (!stdin.isTTY) return
  stdin.setRawMode(true)
  stdin.resume()
  stdin.on('data', (d: Buffer) => {
    const key = d.toString()

    if (key === '\x03') void quit(0)
    else if (quitMenuView.menu) {
      const next = menuKey(quitMenuView.menu, key)

      quitMenuView.menu = next.menu
      markDirty()
      if (next.quit) void quit(0, next.quit)
    } else if (copyRuntimePassword(key)) markDirty()
    else if (key === 'q') {
      quitMenuView.menu = OPEN_MENU
      markDirty()
    } else if (key === 'r') void restartAll()
  })
}

// Signals + last-resort teardown so nothing is ever orphaned.
process.on('SIGINT', () => void quit(0))
process.on('SIGTERM', () => void quit(0))
process.on('SIGHUP', () => void quit(0))
process.on('uncaughtException', (e) => {
  pushEvent(backend, `fatal: ${e instanceof Error ? e.message : String(e)}`)
  void quit(1)
})
// Synchronous safety net: if we exit for any reason with children still alive,
// hard-kill every group that was ever started — a group outlives its leader,
// and an already-empty one just makes kill throw.
process.on('exit', () => {
  releaseInstance()
  unregisterLauncher()
  for (const s of services) {
    const pid = s.proc?.pid

    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* gone */
      }
    }
  }
  // Quick tunnel is ours to reap; the named tunnel is shared infra, left alone.
  if (tunnel.kind === 'quick' && tunnel.proc?.pid) {
    try {
      process.kill(-tunnel.proc.pid, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
  releaseAllPorts()
})
process.stdout.on('resize', () => {
  markDirty()
})

async function main() {
  if (DEV_OPTIONS.managed !== null && !isLocalContextName(DEV_OPTIONS.managed)) {
    process.stderr.write(
      `--managed only runs against a local cluster (orbstack, docker-desktop, minikube, kind-*); refusing "${DEV_OPTIONS.managed}".\n`,
    )
    process.exit(2)
  }
  try {
    releaseInstance = await acquireDevInstance(ROOT)
    unregisterLauncher = registerLauncher()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
  await waitForReset()
  enterAltScreen()
  bindKeys()
  const mode = DEV_OPTIONS.mode === 'admin' ? ' --admin' : ''

  if (!TTY) process.stdout.write(`▲ nuphos dev${mode}  (${WT_ID})\n`)
  render()
  setInterval(() => {
    if (consumeDirty()) render()
  }, 120)
  // Independent of `dirty`: a hung service produces no output, so nothing would
  // ever mark the frame dirty and the stall would go unreported.
  setInterval(checkStalls, 2_000)
  ensureBackendEnv()
  if (DEV_OPTIONS.reset) await resetStack()
  await startAll()
}

void main()
