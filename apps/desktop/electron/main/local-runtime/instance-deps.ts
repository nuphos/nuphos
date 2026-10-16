import { prepareIsolatedAgentHome } from './agent-home.ts'
import { userDir } from './controller-types.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'

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
): LocalRuntimeControllerDeps {
  return {
    ...deps,
    dataDir: () => dir,
    userEnv: async () => ({
      ...(await deps.userEnv()),
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
