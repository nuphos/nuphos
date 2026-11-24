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

/** Every agent Nuphos can install: all but Antigravity, which comes only as a desktop app. */
export const INSTALLABLE = [
  'claude-code',
  'codex',
  'pi',
  'grok',
  'hermes',
  'opencode',
  'dsh',
  'cursor',
] as const

type Installable = (typeof INSTALLABLE)[number]

/** The npm package each vendor installs its CLI as. */
const NPM_PACKAGE = {
  codex: '@openai/codex',
  pi: '@earendil-works/pi-coding-agent',
  opencode: 'opencode-ai',
  // Every release so far is a prerelease, which a bare name never matches.
  dsh: '@deepseek-ai/dsh@latest',
}

/** The vendors whose own script installs their CLI: macOS and Linux, then Windows if it runs there. */
const SCRIPT: Partial<Record<Installable, [string, string?]>> = {
  'claude-code': [
    'curl -fsSL https://claude.ai/install.sh | bash',
    'irm https://claude.ai/install.ps1 | iex',
  ],
  grok: ['curl -fsSL https://x.ai/cli/install.sh | bash', 'irm https://x.ai/cli/install.ps1 | iex'],
  hermes: [
    'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive',
    '& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -NonInteractive',
  ],
  // Its Windows login lives in APPDATA, which Nuphos does not share with a conversation yet.
  cursor: ['curl -fsSL https://cursor.com/install | bash'],
}

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
  const script = SCRIPT[provider]

  if (script) {
    const [posix, powershell] = script

    if (!windows) return { file: '/bin/bash', args: ['-c', posix] }
    if (!powershell) return null

    return {
      file: powershellPath(env),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell],
    }
  }

  const npm = onPath('npm', env)
  const pkg = NPM_PACKAGE[provider as keyof typeof NPM_PACKAGE]

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
  const installable = (INSTALLABLE as readonly string[]).includes(provider)
  const command = installable ? installCommand(provider as Installable, env) : null

  // Only the npm installs can find nothing to run: this computer has no Node.js.
  if (!command)
    return Promise.reject(
      new Error(
        provider === 'cursor'
          ? 'Cursor runs as a local runtime on macOS and Linux.'
          : 'Install Node.js from https://nodejs.org there, then try again.',
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
