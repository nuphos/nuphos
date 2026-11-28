import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { locateAgentCli, run } from './agent-cli.ts'
import {
  OPENCODE_AUTH_LIST,
  openCodeConnected,
  openCodeCredentials,
  openCodeLogout,
} from './agent-cli-opencode.ts'
import { codexOwnerHome } from './agent-home.ts'
import { agentCliEnv } from './config.ts'
import { LOGIN_FILE } from './providers.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

export const ANTIGRAVITY_SIGN_OUT =
  'Sign out with the official Antigravity CLI; this may sign out other local Antigravity apps'

/** The files besides its LOGIN_FILE in which an agent's home keeps a sign-in. */
const CREDENTIAL_FILES: Partial<Record<LocalAgentProvider, readonly string[]>> = {
  'claude-code': ['.credentials.json', '.nuphos-oauth-token.json'],
  codex: ['auth.json', '.nuphos-auth-revision'],
  // OpenCode 1.x; 2.x keeps its credentials in a database, which logoutOpenCode empties.
  opencode: ['.local/share/opencode/auth.json'],
}

/** What opencode-login.mjs saves in OpenCode's config for Bedrock; its region stays. */
const BEDROCK_SECRETS = ['accessKeyId', 'secretAccessKey', 'sessionToken', 'apiKey']

/** The homes in `dir`: its directories only, as markers such as `.sweep` sit beside them. */
const homesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name))
  } catch (error) {
    // Only a home with no conversations yet: any other error would leave their logins.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

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
  const files = [...(CREDENTIAL_FILES[provider] ?? []), LOGIN_FILE[provider] ?? []].flat()
  // Each conversation's home mirrors this one, and Pi copies its login into it.
  const sessions = path.join(home, '.nuphos', 'session-homes')
  const homes = [home, ...homesIn(sessions)]

  for (const at of homes) for (const file of files) rmSync(path.join(at, file), { force: true })
  if (provider === 'claude-code')
    dropJsonKeys(path.join(home, 'settings.json'), ['env'], ['ANTHROPIC_API_KEY'])
  if (provider === 'opencode') {
    const config = path.join(home, '.config', 'opencode', 'opencode.json')

    dropJsonKeys(config, ['provider', 'amazon-bedrock', 'options'], BEDROCK_SECRETS)
    // The OpenRouter key a new account's free Box comes with (box-openrouter.ts in the backend),
    // with its entry: OpenCode keeps a configured provider's model even with no key for it.
    dropJsonKeys(config, ['provider'], ['openrouter'])
  }
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
const STILL_SIGNED_IN =
  'The agent is still signed in, for example with an API key set on this computer. Remove it there, then try again'
const OPENCODE_UNREAD =
  'Nuphos could not read which providers OpenCode is signed in to, so it did not sign it out. Try again'

/**
 * Logs OpenCode 2.x out of every provider credential its database holds in this home, one at a
 * time; its sessions stay. A logout that fails is left to the list read after it: OpenCode exits
 * 1 for a credential that is already gone. Whether a provider is still connected: false also
 * without OpenCode, undefined when the list cannot be read (a 1.x CLI has none).
 */
export async function logoutOpenCode(
  env: NodeJS.ProcessEnv,
  agentHome: string,
): Promise<boolean | undefined> {
  const file = await locateAgentCli('opencode', env)

  if (!file) return false
  const runtimeEnv = agentCliEnv({ provider: 'opencode', env, agentHome, cliPath: file })
  const list = () => run(file, OPENCODE_AUTH_LIST, runtimeEnv).catch(() => '')

  for (const { integration, credential } of openCodeCredentials(await list()))
    await run(file, openCodeLogout(integration, credential), runtimeEnv).catch(() => '')

  return openCodeConnected(await list())
}

/**
 * Whether the agent is still signed in once its credentials were deleted, so a reset fails
 * rather than reports a sign-out it could not make: a key in the computer's environment, say.
 * OpenCode is always signed in, to its free models, so its CLI status cannot tell: logs each
 * credential out, then asks OpenCode whether any provider is still connected. Only a list it
 * read and found empty will do; a 1.x CLI has no list, its login being the file deleted before
 * this. The error to fail with, or undefined.
 */
export async function credentialsLeft(
  provider: LocalAgentProvider,
  home: string,
  deps: Pick<LocalRuntimeControllerDeps, 'probeCli' | 'userEnv'> & {
    logout?: typeof logoutOpenCode
  },
): Promise<Error | undefined> {
  const env = await deps.userEnv()

  if (provider !== 'opencode') {
    const cli = await deps.probeCli(provider, env, home).catch(() => undefined)

    return cli?.installed && cli.loggedIn ? new Error(STILL_SIGNED_IN) : undefined
  }
  const connected = await (deps.logout ?? logoutOpenCode)(env, home).catch(() => undefined)

  if (connected !== undefined) return connected ? new Error(OPENCODE_SIGNED_IN) : undefined
  const cli = await deps.probeCli(provider, env, home).catch(() => {})

  if (!cli) return new Error(OPENCODE_UNREAD)
  if (!cli.installed) return undefined
  const major = Number(cli.version?.split('.')[0])

  return Number.isNaN(major) || major >= 2 ? new Error(OPENCODE_UNREAD) : undefined
}
