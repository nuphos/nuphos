import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { findAgentCli } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { agentCliEnv } from './config.ts'

type Provider = 'claude-code' | 'codex'

/** The CLI and the home its login lands in, as the runtime runs it. */
export function loginTarget(
  provider: Provider,
  userDir: string,
  env: NodeJS.ProcessEnv,
  ownerHome: string,
) {
  const cliPath = findAgentCli(provider, env)
  const agentHome =
    provider === 'codex'
      ? (env.CODEX_HOME ?? path.join(env.HOME ?? ownerHome, '.codex'))
      : prepareAgentHome(provider, userDir, path.join(userDir, 'workspace'))

  if (!cliPath || !agentHome) throw new Error('Install the runtime on this computer first.')

  mkdirSync(agentHome, { recursive: true, mode: 0o700 })

  return { cliPath, agentHome, env: agentCliEnv({ provider, env, cliPath, agentHome }) }
}

/** The bundled login wrapper the runtime's own sign-in runs, here for a key or a sign-out. */
export function loginWrapper(
  provider: Provider,
  bundleRoot: string,
  target: ReturnType<typeof loginTarget>,
) {
  const wrapper = path.join(bundleRoot, `${provider === 'codex' ? 'codex' : 'claude'}-login.mjs`)

  if (!existsSync(wrapper)) throw new Error('Update Nuphos to sign in with an API key.')

  return {
    command: process.execPath,
    args: [wrapper, ...(provider === 'codex' ? ['--install'] : [])],
    env: {
      ...target.env,
      ...(provider === 'codex'
        ? { CODEX_EXECUTABLE: target.cliPath, NUPHOS_CODEX_AUTH_DIRECTORY: target.agentHome }
        : {}),
    },
  }
}
