import { spawn } from 'node:child_process'

import type { ChildProcess } from 'node:child_process'

export type ClaudeLoginState = {
  state: 'idle' | 'waiting' | 'checking' | 'connected' | 'failed' | 'cancelled'
  url?: string
  error?: string
}

/** Only an authorization URL leaves the CLI. Tokens and raw output never reach the renderer. */
export function claudeLoginUrl(output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/gu)) {
    try {
      const url = new URL(match[0])

      if (
        ['claude.ai', 'claude.com'].includes(url.hostname) &&
        url.pathname === '/oauth/authorize' &&
        !url.username &&
        !url.password &&
        !url.port
      )
        return url.href
    } catch {
      // Wait for a complete URL in the next chunk.
    }
  }
}

export class ClaudeLogin {
  private child: ChildProcess | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private value: ClaudeLoginState = { state: 'idle' }
  private generation = 0

  private readonly deps: {
    changed: () => void
    connected: () => Promise<boolean>
    spawn?: typeof spawn
  }

  constructor(deps: ClaudeLogin['deps']) {
    this.deps = deps
  }

  state(): ClaudeLoginState {
    return this.value
  }

  private update(value: ClaudeLoginState): void {
    this.value = value
    this.deps.changed()
  }

  cancel(): void {
    this.generation += 1
    clearTimeout(this.timer)
    this.child?.kill()
    this.child = undefined
    this.update({ state: 'cancelled' })
  }

  start(cli: string, env: NodeJS.ProcessEnv): ClaudeLoginState {
    if (this.value.state === 'waiting' || this.value.state === 'checking') return this.value
    const generation = ++this.generation
    const current = () => generation === this.generation
    let output = ''

    this.update({ state: 'waiting' })
    let child: ChildProcess

    try {
      child = (this.deps.spawn ?? spawn)(cli, ['auth', 'login', '--claudeai'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: cli.endsWith('.cmd'),
      })
    } catch {
      this.update({ state: 'failed', error: 'Could not start Claude sign-in. Please try again.' })

      return this.value
    }

    this.child = child
    const fail = (error: string) => {
      if (!current()) return
      this.generation += 1
      clearTimeout(this.timer)
      child.kill()
      this.child = undefined
      this.update({ state: 'failed', error })
    }
    const receive = (chunk: Buffer) => {
      if (!current()) return
      output = (output + chunk.toString()).slice(-16_384)
      const url = claudeLoginUrl(output)

      if (url && url !== this.value.url) this.update({ state: 'waiting', url })
    }

    child.stdout?.on('data', receive)
    child.stderr?.on('data', receive)
    child.once('error', () =>
      fail('Could not open Claude sign-in. Check that Claude Code is installed and try again.'),
    )
    child.once('exit', (code) => {
      if (!current()) return
      if (code !== 0) {
        fail('Claude sign-in did not finish. Please try again.')

        return
      }
      clearTimeout(this.timer)
      this.child = undefined
      this.update({ state: 'checking' })
      void this.deps.connected().then(
        (ready) => {
          if (current())
            this.update(
              ready
                ? { state: 'connected' }
                : {
                    state: 'failed',
                    error: 'Sign-in finished, but Claude is not ready yet. Please try again.',
                  },
            )
        },
        () => {
          if (current())
            this.update({ state: 'failed', error: 'Could not verify sign-in. Please try again.' })
        },
      )
    })
    this.timer = setTimeout(() => fail('Sign-in timed out. Please try again.'), 5 * 60_000)

    return this.value
  }
}
