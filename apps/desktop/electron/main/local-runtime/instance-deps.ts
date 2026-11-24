import { INSTALLABLE, installAgentCli } from './agent-cli-install.ts'
import { credentialsLeft, deleteAgentCredentials } from './agent-credentials.ts'
import { prepareIsolatedAgentHome } from './agent-home.ts'
import { userDir } from './controller-types.ts'
import { agentHomeName } from './providers.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

/** An added agent's own install of its missing CLI: tried once, reported while it runs. */
export type CliInstall = { tried?: true; installing?: true; error?: string }

/** Where an added Claude keeps its Keychain sign-in apart from every other one. */
export function secureStorageEnv(dir: string, userId: string): NodeJS.ProcessEnv {
  return { CLAUDE_SECURESTORAGE_CONFIG_DIR: userDir(dir, userId, 'claude-home') }
}

/** An added agent's controller: its own directory and login, the parent's one tunnel. */
export function instanceControllerDeps(
  deps: LocalRuntimeControllerDeps,
  dir: string,
  userId: string,
  changed: () => void,
  /** Present while the agent is being added: its missing CLI is installed. */
  install?: CliInstall,
): LocalRuntimeControllerDeps {
  const installCli = deps.installCli ?? installAgentCli

  return {
    ...deps,
    dataDir: () => dir,
    // Adding an agent asks for it to run here, so a CLI that is missing is installed first.
    probeCli: async (provider, env, home) => {
      const cli = await deps.probeCli(provider, env, home)

      if (
        cli.installed ||
        cli.error ||
        !install ||
        install.tried ||
        !installCli ||
        !(INSTALLABLE as readonly string[]).includes(provider)
      )
        return cli
      install.tried = true
      install.installing = true
      changed()
      try {
        // Once more after a failure: an installer's download can fail for a moment.
        await installCli(provider, env).catch(() => installCli(provider, env))
      } catch (error) {
        install.error = (error as Error).message.slice(0, 500)

        return cli
      } finally {
        delete install.installing
        changed()
      }

      return deps.probeCli(provider, env, home)
    },
    userEnv: async (fresh) => ({
      ...(await deps.userEnv(fresh)),
      ...secureStorageEnv(dir, userId),
    }),
    prepareAgentHome: prepareIsolatedAgentHome,
    readCliCache: () => ({}),
    writeCliCache: () => {
      /* Each instance probes its own login. */
    },
    registerDevice: async () => {
      /* One parent device owns every instance. */
    },
    createTunnel: () => ({
      start() {
        /* Parent owns tunnel. */
      },
      stop() {
        /* Parent owns tunnel. */
      },
      sendStatus: changed,
      reconnectNow() {
        /* Parent owns tunnel. */
      },
    }),
    onChange: changed,
  }
}

/**
 * Deletes an added agent's logins and Claude's Keychain entry, then checks with its own deps,
 * which find that entry, whether it is still signed in: the error to fail a reset with.
 */
export async function signOutInstance(
  deps: LocalRuntimeControllerDeps,
  dir: string,
  userId: string,
  provider: LocalAgentProvider,
  removeCredential: (env: NodeJS.ProcessEnv) => Promise<void>,
): Promise<Error | undefined> {
  const home = userDir(dir, userId, agentHomeName(provider))

  deleteAgentCredentials(provider, home)
  if (provider === 'claude-code') await removeCredential(secureStorageEnv(dir, userId))

  return credentialsLeft(
    provider,
    home,
    instanceControllerDeps(deps, dir, userId, () => undefined),
  )
}
