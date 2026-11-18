import { execFile } from 'node:child_process'
import path from 'node:path'

import {
  envValue,
  executable,
  forgetWindowsStorePackages,
  powershellPath,
} from './agent-cli-apps.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

const INSTALL_TIMEOUT_MS = 10 * 60_000

type Command = { file: string; args: string[]; shell?: boolean }

/** Nuphos installs only the CLIs it has a vendor installer for. */
export const INSTALLABLE = ['claude-code', 'codex', 'pi'] as const

type Installable = (typeof INSTALLABLE)[number]

/** The npm package each vendor installs its CLI as. */
const NPM_PACKAGE = { codex: '@openai/codex', pi: '@earendil-works/pi-coding-agent' }

function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const names = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`] : [name]

  for (const dir of (envValue(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean))
    for (const candidate of names)
      if (executable(path.join(dir, candidate))) return path.join(dir, candidate)

  return null
}

/** Each vendor's own installer for this platform; none of them needs administrator rights. */
export function installCommand(provider: Installable, env: NodeJS.ProcessEnv): Command | null {
  const windows = process.platform === 'win32'
  // The end-to-end harness's stand-in, so a run installs no vendor's CLI.
  const standIn = envValue(env, 'NUPHOS_E2E_AGENT_INSTALLER')

  if (standIn) return { file: '/bin/sh', args: [standIn, provider] }
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
  const pkg = NPM_PACKAGE[provider]

  // A .cmd runs only through cmd.exe, which splits an unquoted path such as C:\Program Files.
  if (npm)
    return npm.endsWith('.cmd')
      ? { file: `"${npm}"`, args: ['install', '-g', pkg], shell: true }
      : { file: npm, args: ['install', '-g', pkg] }
  // Without Node.js, Windows gets Codex from the ChatGPT app, which ships codex.exe.
  const winget = windows && provider === 'codex' ? onPath('winget', env) : null

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
  // Grok Build, OpenCode and DeepSeek Harness install on their own; Nuphos offers only these.
  const installable = (INSTALLABLE as readonly string[]).includes(provider)
  const command = installable ? installCommand(provider as Installable, env) : null

  if (!command)
    return Promise.reject(
      new Error(
        `Install Node.js first, then run \`npm install -g ${NPM_PACKAGE[provider as keyof typeof NPM_PACKAGE] ?? NPM_PACKAGE.codex}\` in a terminal.`,
      ),
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
