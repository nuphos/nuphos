// `nuphos agent` in a terminal: Claude's own sign-in, into the runtime's config dir.

import { spawn } from 'node:child_process'
import path from 'node:path'

import { findAgentCli } from './agent-cli.ts'
import { agentCliEnv } from './config.ts'

import type { prepareAgentHome } from './agent-home.ts'
import type { LocalRuntimeController } from './controller.ts'

/** Sign in only when the same credential store used by the agent is not authenticated. */
export async function signInClaude(
  controller: LocalRuntimeController,
  dataDir: string,
  ownerId: string,
  prepareHome: typeof prepareAgentHome,
): Promise<void> {
  const cli = controller.state().agents['claude-code'].cli

  if (!cli?.installed || cli.loggedIn || !process.stdin.isTTY) return
  const cliPath = findAgentCli('claude-code', process.env)
  const userDir = path.join(dataDir, 'users', ownerId)
  const agentHome = prepareHome('claude-code', userDir, path.join(userDir, 'workspace'))

  if (!cliPath || !agentHome) return
  console.log(
    process.platform === 'darwin'
      ? 'Sign Claude Code in for Nuphos (updates the Claude login used by your terminal):'
      : 'Sign Claude Code in for Nuphos (a separate sign-in from your own terminal):',
  )
  await new Promise((resolve) => {
    spawn(cliPath, ['auth', 'login', '--claudeai'], {
      env: agentCliEnv({ provider: 'claude-code', env: process.env, cliPath, agentHome }),
      stdio: 'inherit',
    })
      .on('exit', resolve)
      .on('error', resolve)
  })
  await controller.refresh(true, ['claude-code'])
}
