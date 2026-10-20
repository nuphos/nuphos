import { execFile } from 'node:child_process'
import path from 'node:path'

import {
  envValue,
  executable,
  forgetWindowsStorePackages,
  powershellPath,
} from './agent-cli-apps.ts'
import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

const INSTALL_TIMEOUT_MS = 10 * 60_000

type Command = { file: string; args: string[]; shell?: boolean }

function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const names = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`] : [name]

  for (const dir of (envValue(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean))
    for (const candidate of names)
      if (executable(path.join(dir, candidate))) return path.join(dir, candidate)

  return null
}

/** Each vendor's own installer for this platform; none of them needs administrator rights. */
export function installCommand(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Command | null {
  const windows = process.platform === 'win32'

  if (provider === 'claude-code')
    return windows
      ? {
          file: powershellPath(env),
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'irm https://claude.ai/install.ps1 | iex',
          ],
        }
      : { file: '/bin/bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] }

  const npm = onPath('npm', env)

  // A .cmd runs only through cmd.exe, which splits an unquoted path such as C:\Program Files.
  if (npm)
    return npm.endsWith('.cmd')
      ? { file: `"${npm}"`, args: ['install', '-g', '@openai/codex'], shell: true }
      : { file: npm, args: ['install', '-g', '@openai/codex'] }
  // Without Node.js, Windows gets Codex from the ChatGPT app, which ships codex.exe.
  const winget = windows ? onPath('winget', env) : null

  if (winget)
    return {
      file: winget,
      args: [
        'install',
        '--id',
        '9PLM9XGG6VKS',
        '--source',
        'msstore',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity',
      ],
    }

  return null
}

/** Installs the agent's CLI the way its vendor documents, as the signed-in user. */
export function installAgentCli(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const command = LOCAL_AGENT_PROVIDERS.includes(provider) ? installCommand(provider, env) : null

  if (!command)
    return Promise.reject(
      new Error('Install Node.js first, then run `npm install -g @openai/codex` in a terminal.'),
    )

  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      { env, timeout: INSTALL_TIMEOUT_MS, windowsHide: true, shell: command.shell ?? false },
      (error, stdout, stderr) => {
        forgetWindowsStorePackages()
        if (!error) return resolve()
        const output = `${stderr}${stdout}`.trim().split(/\r?\n/u).slice(-3).join('\n')

        reject(new Error(output || error.message))
      },
    )
  })
}
