import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'

import type { ChildProcess } from 'node:child_process'

export type LocalAgentLoginState = {
  state: 'idle' | 'waiting' | 'checking' | 'connected' | 'failed' | 'cancelled'
  url?: string
  userCode?: string
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

export class LocalAgentLogin {
  private child: ChildProcess | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private value: LocalAgentLoginState = { state: 'idle' }
  private generation = 0

  private readonly deps: {
    provider?: 'claude-code' | 'codex'
    changed: () => void
    connected: () => Promise<boolean>
    spawn?: typeof spawn
  }

  constructor(deps: LocalAgentLogin['deps']) {
    this.deps = deps
  }

  state(): LocalAgentLoginState {
    return this.value
  }

  private update(value: LocalAgentLoginState): void {
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

  start(cli: string, env: NodeJS.ProcessEnv): LocalAgentLoginState {
    if (this.value.state === 'waiting' || this.value.state === 'checking') return this.value
    const generation = ++this.generation
    const current = () => generation === this.generation
    let output = ''
    const codex = this.deps.provider === 'codex'
    const name = codex ? 'Codex' : 'Claude'

    this.update({ state: 'waiting' })
    let child: ChildProcess

    try {
      child = (this.deps.spawn ?? spawn)(
        cli,
        codex
          ? ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth']
          : ['auth', 'login', '--claudeai'],
        {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: cli.endsWith('.cmd'),
        },
      )
    } catch {
      this.update({ state: 'failed', error: `Could not start ${name} sign-in. Please try again.` })

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
      const plain = stripVTControlCharacters(output)
      const userCode =
        codex && plain.includes('https://auth.openai.com/codex/device')
          ? /Enter this one-time code[^\n]*\n[ \t]*([A-Za-z0-9-]{4,32})[ \t]*\r?\n/u.exec(
              plain,
            )?.[1]
          : undefined
      const url = codex
        ? userCode
          ? 'https://auth.openai.com/codex/device'
          : undefined
        : claudeLoginUrl(output)

      if (url && url !== this.value.url)
        this.update({ state: 'waiting', url, ...(userCode ? { userCode } : {}) })
    }

    child.stdout?.on('data', receive)
    child.stderr?.on('data', receive)
    child.once('error', () =>
      fail(`Could not open ${name} sign-in. Check that it is installed and try again.`),
    )
    child.once('exit', (code) => {
      if (!current()) return
      if (code !== 0) {
        fail(`${name} sign-in did not finish. Please try again.`)

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
                    error: `Sign-in finished, but ${name} is not ready yet. Please try again.`,
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
