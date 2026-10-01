import { spawn } from 'node:child_process'
import os from 'node:os'

// GUI-launched apps on macOS/Linux inherit launchd's minimal PATH (no
// /opt/homebrew/bin etc.), and `$SHELL -lc` is non-interactive so it skips
// ~/.zshrc / ~/.bashrc where many users configure their PATH. To match what
// the user's terminal actually sees, run their shell once as an interactive
// login shell, dump `env` between markers, and cache the result.

const MARKER = '__NUPHOS_SHELL_ENV_MARKER__'
const RESOLVE_TIMEOUT_MS = 10_000
// Interactive rc files can print arbitrary noise (prompts, banners) around the
// markers; give the buffer plenty of headroom.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

// Vars that describe the probe shell invocation itself, not the user's
// environment — never copy these into spawned commands.
const SKIPPED_VARS = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD', 'SHELL_SESSION_ID', 'TERM_SESSION_ID'])

export function userShell(): string {
  let shell: string | undefined

  try {
    shell = os.userInfo().shell || undefined
  } catch {
    shell = undefined
  }

  return shell || process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
}

function parseEnvBlock(block: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  let current: string | undefined

  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_]\w*)=(.*)$/.exec(line)

    if (match) {
      current = match[1]
      env[current] = match[2]
    } else if (current !== undefined) {
      // Continuation of a multiline value.
      env[current] = `${env[current] ?? ''}\n${line}`
    }
  }
  for (const key of SKIPPED_VARS) delete env[key]

  return env
}

function probeShellEnv(): Promise<NodeJS.ProcessEnv | null> {
  return new Promise((resolve) => {
    // `command env` bypasses any alias/function named `env`; printf is a
    // builtin in zsh, bash, and fish alike.
    const probe = `printf '%s' '${MARKER}'; command env; printf '%s' '${MARKER}'`
    // Flags passed separately ('-l' '-i' '-c') because fish rejects the
    // combined '-lic' form.
    const child = spawn(userShell(), ['-l', '-i', '-c', probe], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let stdout = ''
    let settled = false
    const finish = (result: NodeJS.ProcessEnv | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, RESOLVE_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish(null)
      }
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      const start = stdout.indexOf(MARKER)
      const end = stdout.lastIndexOf(MARKER)

      if (start === -1 || end <= start) return finish(null)
      const env = parseEnvBlock(stdout.slice(start + MARKER.length, end))

      // PATH is the whole point — a dump without it means the probe failed.
      finish(env.PATH ? env : null)
    })
  })
}

let cached: Promise<NodeJS.ProcessEnv | null> | undefined

/**
 * Environment of the user's interactive login shell, or null if it could not
 * be resolved (Windows, exotic shells, rc files that hang). Resolved once per
 * app run and cached, including failures.
 */
export function resolveShellEnv(): Promise<NodeJS.ProcessEnv | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  cached ??= probeShellEnv().catch(() => null)

  return cached
}
