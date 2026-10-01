// The runtime row: the compose runtime container and what adding it to a team
// by hand in Settings › Agents takes.
import { spawn } from 'node:child_process'

import { COMPOSE, COMPOSE_DIR, RUNTIME_PASSWORD_ARGS } from './dev-compose.ts'
import { markDirty, pushEvent, TTY } from './dev-event-log.ts'
import { localRuntimeUrl } from './dev-local-stack-env.ts'
import { runDevCommand } from './dev-process.ts'
import { runtime } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'
import { resetRow, startRuntimeContainer } from './dev-stack.ts'

import type { LocalStack } from './dev-local-stack-env.ts'

export const PASSWORD_HINT = 'bun run dev:runtime-password'
const CAN_COPY = TTY && process.platform === 'darwin'

let password: string | null = null

/** The password the runtime generated on first boot; null until its container has written it. */
async function readRuntimePassword(): Promise<string | null> {
  let found = ''
  const result = await runDevCommand('docker', [...COMPOSE, ...RUNTIME_PASSWORD_ARGS], {
    cwd: COMPOSE_DIR,
    timeoutMs: 20_000,
    onStdout: (line) => {
      found ||= line.trim()
    },
  })

  return result.exitCode === 0 && found ? found : null
}

/** The `p` key: copies the runtime's password; false leaves the key to the caller. */
export function copyRuntimePassword(key: string): boolean {
  if (key !== 'p' || !CAN_COPY || !password) return false
  const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })

  child.on('error', () => pushEvent(runtime, `could not copy the password — ${PASSWORD_HINT}`))
  child.stdin.end(password)
  pushEvent(runtime, 'copied the runtime password to the clipboard')

  return true
}

let runtimeAttempt = 0

export async function startLocalRuntime(local: LocalStack) {
  const attempt = ++runtimeAttempt
  const current = () => !isQuitting() && attempt === runtimeAttempt

  password = null
  resetRow(runtime, localRuntimeUrl(local))
  if (!(await startRuntimeContainer()) || !current()) return
  let found = await readRuntimePassword()

  if (!found) pushEvent(runtime, 'waiting for the runtime to write its password …')
  while (!found) {
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    if (!current()) return
    found = await readRuntimePassword()
  }
  if (!current()) return
  password = found
  runtime.status = 'ready'
  runtime.readyMs = runtime.startedAt ? Date.now() - runtime.startedAt : null
  runtime.health = {
    add: 'Settings › Agents › connect your own agent',
    password: CAN_COPY ? `p copies it (or ${PASSWORD_HINT})` : PASSWORD_HINT,
  }
  pushEvent(runtime, `ready — add ${localRuntimeUrl(local)} to a team in Settings › Agents`)
  markDirty()
}
