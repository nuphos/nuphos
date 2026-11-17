import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'

import type { ChildProcess } from 'node:child_process'

export type LocalAgentLoginState = {
  state: 'idle' | 'waiting' | 'checking' | 'connected' | 'failed' | 'cancelled'
  url?: string
  userCode?: string
  error?: string
}

/** The agent's own sign-in command: Claude's browser flow, Codex's device flow. */
export function agentSignInArgs(provider: 'claude-code' | 'codex'): string[] {
  return provider === 'codex'
    ? ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth']
    : ['auth', 'login', '--claudeai']
}

/** Only an authorization URL leaves the CLI. Tokens and raw output never reach the renderer. */
export function claudeLoginUrl(output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/gu)) {
    try {
      const url = new URL(match[0])

      if (
        ['claude.ai', 'claude.com'].includes(url.hostname) &&
        ['/oauth/authorize', '/cai/oauth/authorize'].includes(url.pathname) &&
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

/** What a person pastes as an API key; the provider's CLI decides whether it works. */
export function isApiKey(provider: 'claude-code' | 'codex', value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (provider === 'codex' ? /^sk-(?!ant-)[\w-]{20,400}$/u : /^sk-ant-[\w-]{20,400}$/u).test(
      value.trim(),
    )
  )
}

/**
 * The bundled login wrapper, once: `--api-key` reads the key from stdin, `--sign-out` removes
 * it. The key goes only to its stdin; its output is read for the final frame type and dropped.
 */
export function runLoginWrapper(
  run: { command: string; args: string[]; env: NodeJS.ProcessEnv },
  key: string | null,
  spawnProcess: typeof spawn = spawn,
): Promise<'authenticated' | 'signedOut'> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(run.command, [...run.args, key ? '--api-key' : '--sign-out'], {
      env: run.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let output = ''
    const timer = setTimeout(() => child.kill(), 60_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(key ? `${key.trim()}\n` : '\n')
    child.once('error', () => reject(new Error('Could not start sign-in. Please try again.')))
    child.once('close', (code) => {
      clearTimeout(timer)
      const last = output.trim().split('\n').at(-1) ?? ''
      let type: unknown

      try {
        type = (JSON.parse(last) as { type?: unknown }).type
      } catch {
        type = undefined
      }
      if (code === 0 && (type === 'authenticated' || type === 'signedOut')) resolve(type)
      else
        reject(new Error(key ? 'The API key was not accepted.' : 'Could not remove the API key.'))
    })
  })
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
    /** After an account sign-in: an API key would still outrank it, so it is removed. */
    accountSignedIn?: () => Promise<void>
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

  /** Signs in with an API key, or with null removes it. A running sign-in stops first. */
  async applyApiKey(
    run: { command: string; args: string[]; env: NodeJS.ProcessEnv },
    key: string | null,
  ): Promise<void> {
    if (key !== null && !isApiKey(this.deps.provider ?? 'claude-code', key))
      throw new Error('Paste the whole API key.')
    this.generation += 1
    clearTimeout(this.timer)
    this.child?.kill()
    this.child = undefined
    const generation = this.generation

    this.update({ state: 'checking' })
    try {
      await runLoginWrapper(run, key, this.deps.spawn)
      const ready = await this.deps.connected()

      if (generation !== this.generation) return
      if (key && !ready) throw new Error('The API key was saved, but the runtime is not ready yet.')
      this.update({ state: key ? 'connected' : 'idle' })
    } catch (error) {
      if (generation === this.generation)
        this.update({ state: 'failed', error: (error as Error).message })
      throw error
    }
  }

  /** Authorization codes go only to the current CLI's stdin, never state or logs. */
  submitCode(value: unknown): void {
    if (
      this.deps.provider === 'codex' ||
      this.value.state !== 'waiting' ||
      !this.value.url ||
      !this.child?.stdin
    )
      throw new Error('Start Claude sign-in before submitting a code.')
    if (typeof value !== 'string' || !/^[\w.~-]{1,2048}#[\w.~-]{1,512}$/u.test(value.trim()))
      throw new Error('Paste the authorization code from the Claude sign-in page.')
    this.child.stdin.write(`${value.trim()}\n`)
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
      child = (this.deps.spawn ?? spawn)(cli, agentSignInArgs(codex ? 'codex' : 'claude-code'), {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: cli.endsWith('.cmd'),
      })
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

    child.stdin?.on('error', () => fail('Could not submit the sign-in code. Please try again.'))
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
      void (this.deps.accountSignedIn?.() ?? Promise.resolve())
        .then(() => this.deps.connected())
        .then(
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
