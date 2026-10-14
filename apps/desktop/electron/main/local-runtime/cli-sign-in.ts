// `nuphos agent login <agent>`: the agent's own sign-in, run in this terminal
// against the login this computer's runtime uses, so a server never needs
// credential files placed by hand.

import { spawn } from 'node:child_process'
import path from 'node:path'

import { AGENT_NAMES, findAgentCli } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { agentCliEnv } from './config.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

/** The same commands the desktop's sign-in runs, with the terminal attached. */
export function signInArgs(provider: LocalAgentProvider): string[] {
  return provider === 'codex'
    ? ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth']
    : ['auth', 'login', '--claudeai']
}

/**
 * Claude signs in to the runtime's isolated config dir under `userDir` (on
 * macOS, the Keychain entry it shares with the terminal). Codex signs in to the
 * owner's Codex home, which the runtime links to. Resolves to the exit status.
 */
export async function signInAgent(provider: LocalAgentProvider, userDir: string): Promise<number> {
  const cliPath = findAgentCli(provider, process.env)

  if (!cliPath) {
    console.error(`${AGENT_NAMES[provider]} is not installed on this computer.`)

    return 1
  }
  let env: NodeJS.ProcessEnv = process.env

  if (provider === 'claude-code') {
    const agentHome = prepareAgentHome(provider, userDir, path.join(userDir, 'workspace'))

    if (!agentHome) {
      console.error(`Could not prepare ${userDir}.`)

      return 1
    }
    env = agentCliEnv({ provider, env: process.env, cliPath, agentHome })
  }
  console.log(`Signing ${AGENT_NAMES[provider]} in for this computer's Nuphos runtime.`)

  return new Promise((resolve) => {
    spawn(cliPath, signInArgs(provider), { env, stdio: 'inherit' })
      .on('exit', (code) => resolve(code ?? 1))
      .on('error', (error) => {
        console.error(`Could not start ${AGENT_NAMES[provider]}: ${error.message}`)
        resolve(1)
      })
  })
}
