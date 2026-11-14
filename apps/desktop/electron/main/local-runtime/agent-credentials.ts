import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { codexOwnerHome } from './agent-home.ts'
import { LOGIN_FILE } from './providers.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

export const ANTIGRAVITY_SIGN_OUT =
  'Sign out with the official Antigravity CLI; this may sign out other local Antigravity apps'

/** The files besides its LOGIN_FILE in which an agent's home keeps a sign-in. */
const CREDENTIAL_FILES: Partial<Record<LocalAgentProvider, readonly string[]>> = {
  'claude-code': ['.credentials.json', '.nuphos-oauth-token.json'],
  codex: ['auth.json', '.nuphos-auth-revision'],
}

/** What opencode-login.mjs saves in OpenCode's config for Bedrock; its region stays. */
const BEDROCK_SECRETS = ['accessKeyId', 'secretAccessKey', 'sessionToken', 'apiKey']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Drops `keys` from the object at `at` in a JSON file and keeps the rest of it. A file that
 * is missing or not plain JSON stays as it is: opencode-login.mjs and claude-login.mjs only
 * ever save a credential in plain JSON.
 */
function dropJsonKeys(file: string, at: readonly string[], keys: readonly string[]): void {
  let json: unknown

  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return
  }
  const parent = at.reduce((value, key) => (isRecord(value) ? value[key] : undefined), json)

  if (!isRecord(parent) || !keys.some((key) => key in parent)) return
  for (const key of keys) Reflect.deleteProperty(parent, key)
  const next = `${file}.${String(process.pid)}.tmp`

  writeFileSync(next, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 })
  renameSync(next, file)
}

/**
 * Deletes every credential an agent's home holds, so it runs signed out; its settings,
 * sessions and workspace stay. Missing files are fine. Claude's Keychain entry is not a
 * file here: the caller deletes it.
 */
export function deleteAgentCredentials(provider: LocalAgentProvider, home: string): void {
  if (provider === 'antigravity') throw new Error(ANTIGRAVITY_SIGN_OUT)
  for (const file of [...(CREDENTIAL_FILES[provider] ?? []), LOGIN_FILE[provider]])
    if (file) rmSync(path.join(home, file), { force: true })
  if (provider === 'claude-code')
    dropJsonKeys(path.join(home, 'settings.json'), ['env'], ['ANTHROPIC_API_KEY'])
  if (provider === 'opencode')
    dropJsonKeys(
      path.join(home, '.config', 'opencode', 'opencode.json'),
      ['provider', 'amazon-bedrock', 'options'],
      BEDROCK_SECRETS,
    )
}

/** A Box's default agent: also the Codex login its home links to, which a launch would link again. */
export function deleteDefaultCredentials(
  provider: LocalAgentProvider,
  home: string,
  env: NodeJS.ProcessEnv,
): void {
  deleteAgentCredentials(provider, home)
  if (provider === 'codex') rmSync(path.join(codexOwnerHome(env), 'auth.json'), { force: true })
}

const OPENCODE_SIGNED_IN =
  'OpenCode still holds provider credentials Nuphos cannot remove. Sign them out in OpenCode, then try again'
const OPENCODE_UNREAD =
  'Nuphos could not read which providers OpenCode is signed in to, so it did not sign it out. Try again'

/**
 * OpenCode 2.x keeps its providers' credentials in its own database, not in a file: asks it
 * whether any is left, so a reset fails rather than reports a sign-out it could not make. Only
 * a list it read and found empty will do; a 1.x CLI has no list, its login being the files.
 * The error to fail with, or undefined.
 */
export async function credentialsLeft(
  provider: LocalAgentProvider,
  home: string,
  deps: Pick<LocalRuntimeControllerDeps, 'probeCli' | 'userEnv'>,
): Promise<Error | undefined> {
  if (provider !== 'opencode') return undefined
  const cli = await deps.probeCli(provider, await deps.userEnv(), home).catch(() => {})

  if (!cli) return new Error(OPENCODE_UNREAD)
  if (!cli.installed) return undefined
  if (cli.loggedIn === true) return new Error(OPENCODE_SIGNED_IN)
  const major = Number(cli.version?.split('.')[0])

  return cli.credentialsUnread && (Number.isNaN(major) || major >= 2)
    ? new Error(OPENCODE_UNREAD)
    : undefined
}
