// This app's own sign-in, for the agents it can run a CLI login for; others sign in from Nuphos.

import { LocalAgentLogin, runLoginWrapper } from './agent-login.ts'
import { loginTarget, loginWrapper } from './login-target.ts'

import type { LocalRuntimeState } from './controller-types.ts'

type CliLoginProvider = 'claude-code' | 'codex'

export function localLogins(deps: {
  changed: () => void
  refresh: (provider: CliLoginProvider) => Promise<LocalRuntimeState>
  userId: () => string | null
  userEnv: () => Promise<NodeJS.ProcessEnv>
  userDir: (userId: string) => string
  ownerHome: () => string
  bundleRoot: () => string
}) {
  const logins = Object.fromEntries(
    (['claude-code', 'codex'] as const).map((provider) => [
      provider,
      new LocalAgentLogin({
        provider,
        changed: deps.changed,
        connected: async () => {
          const cli = (await deps.refresh(provider)).agents[provider].cli

          return cli?.installed === true && cli.loggedIn === true
        },
        // Codex's own sign-in replaces its key; Claude's leaves one in its settings.
        ...(provider === 'claude-code'
          ? {
              accountSignedIn: () =>
                wrapper(provider)
                  .then((run) => runLoginWrapper(run, null))
                  .then(
                    () => {},
                    () => {
                      /* A wrapper too old to know keys never stored one. */
                    },
                  ),
            }
          : {}),
      }),
    ]),
  ) as Record<CliLoginProvider, LocalAgentLogin>
  let request = 0

  /** Where this account's agent signs in on this computer. */
  async function target(provider: CliLoginProvider, userId: string, env?: NodeJS.ProcessEnv) {
    return loginTarget(
      provider,
      deps.userDir(userId),
      env ?? (await deps.userEnv()),
      deps.ownerHome(),
    )
  }

  async function wrapper(provider: CliLoginProvider) {
    const userId = deps.userId()

    if (!userId) throw new Error('Sign in to Nuphos first.')

    return loginWrapper(provider, deps.bundleRoot(), await target(provider, userId))
  }

  return {
    async start(provider: CliLoginProvider) {
      const userId = deps.userId()

      if (!userId) throw new Error('Sign in to Nuphos first.')
      const current = ++request
      const env = await deps.userEnv()
      const login = logins[provider]

      if (current !== request) return login.state()
      if (deps.userId() !== userId) throw new Error('Nuphos account changed. Try again.')
      const { cliPath, env: cliEnv } = await target(provider, userId, env)

      return login.start(cliPath, cliEnv)
    },
    state: (provider: CliLoginProvider) => logins[provider].state(),
    cancel(provider: CliLoginProvider): void {
      request += 1
      logins[provider].cancel()
    },
    submitClaudeCode: (code: unknown) => logins['claude-code'].submitCode(code),
    /** Signs this computer's agent in with an API key, or with null removes the key. */
    async applyApiKey(provider: unknown, key: unknown): Promise<void> {
      if (provider !== 'claude-code' && provider !== 'codex') throw new Error('Unknown runtime.')
      request += 1
      await logins[provider].applyApiKey(
        await wrapper(provider),
        typeof key === 'string' || key === null ? key : '',
      )
    },
  }
}
