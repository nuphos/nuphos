// `nuphos agent login <agent>`: the agent's own sign-in, run in this terminal
// against the login this computer's runtime uses, so a server never needs
// credential files placed by hand.

import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { AGENT_NAMES, findAgentCli } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { signInArgs } from './agent-login.ts'
import { agentCliEnv } from './config.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

/**
 * The same command and environment as the desktop's sign-in, with the terminal
 * attached. Claude signs in to the runtime's isolated config dir under `userDir`
 * (on macOS, the Keychain entry it shares with the terminal); Codex signs in to
 * the owner's Codex home, which the runtime links to. Resolves to the exit status.
 */
export async function signInAgent(provider: LocalAgentProvider, userDir: string): Promise<number> {
  const cliPath = findAgentCli(provider, process.env)

  if (!cliPath) {
    console.error(`${AGENT_NAMES[provider]} is not installed on this computer.`)

    return 1
  }
  const agentHome =
    provider === 'codex'
      ? (process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'))
      : prepareAgentHome(provider, userDir, path.join(userDir, 'workspace'))

  if (!agentHome) {
    console.error(`Could not prepare ${userDir}.`)

    return 1
  }
  console.log(`Signing ${AGENT_NAMES[provider]} in for this computer's Nuphos runtime.`)
  const status = await new Promise<number>((resolve) => {
    spawn(cliPath, signInArgs(provider), {
      env: agentCliEnv({ provider, env: process.env, cliPath, agentHome }),
      stdio: 'inherit',
    })
      .on('exit', (code) => resolve(code ?? 1))
      .on('error', (error) => {
        console.error(`Could not start ${AGENT_NAMES[provider]}: ${error.message}`)
        resolve(1)
      })
  })

  // A running `nuphos agent` probes logins only when it starts an agent.
  if (status === 0)
    console.log(
      'Signed in. Restart the agent to pick it up: `systemctl --user restart nuphos-agent`, or run `nuphos agent` again.',
    )

  return status
}
