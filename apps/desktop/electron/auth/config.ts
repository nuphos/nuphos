import fs from 'node:fs/promises'
import path from 'node:path'

import yaml from 'js-yaml'

import { apiUrl, useAccount } from '../api-endpoint.ts'
import { authSession } from '../auth-session.ts'
import { CLI_CONFIG_PATH, DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

import { accountKey, keyOf, normalizedApi, stored, summaries, waiting } from './accounts.ts'
import { keychainStore, secureStorageEnabled } from './token-store.ts'

import type { AccountContext } from '../auth-session.ts'
import type { UserInfo } from '../auth-status.ts'
import type { AccountSummary, StoredAccount } from './accounts.ts'
import type { TokenStore } from './token-store.ts'

export const NUPHOS_LOGIN_URL =
  process.env.NUPHOS_LOGIN_URL ||
  (process.env.NUPHOS_WEB_URL
    ? new URL('/login', process.env.NUPHOS_WEB_URL).toString()
    : 'https://nuphos.ai/login')

export type Config = {
  /** Resolved by `readConfig` from the keychain; on disk only without one. */
  token?: string
  /** The keychain item holding the token, when it is there (token-store.ts). */
  keychainAccount?: string
  user?: string
  username?: string
  // Full identity from the last successful /auth/me, so a transient failure at
  // startup can keep the session alive instead of looking like a logout.
  userInfo?: UserInfo
  /** The backend that issued the token. */
  api?: string
  /** The other signed-in accounts (accounts.ts). */
  accounts?: StoredAccount[]
}

type ConfigFileDeps = {
  path: string
  store: TokenStore
  secure: () => boolean
  apiUrl: () => string
  /** The account now signed in, with its backend. */
  onAccount: (api: string, token: string | null, userId: string | null) => void
  /** The CLI's cli.yaml, which this app shared before it had its own file. */
  legacyPath?: string
}

// No empty list in the file.
const listed = (accounts: StoredAccount[]) => (accounts.length > 0 ? accounts : undefined)

/** This app's sign-in file, with its token in the keychain where there is one. */
export function configFile(deps: ConfigFileDeps) {
  async function readFile(at: string): Promise<Config | null> {
    try {
      return (yaml.load(await fs.readFile(at, 'utf-8')) as Config | null) ?? {}
    } catch {
      return null
    }
  }

  async function writeFile(at: string, cfg: Config): Promise<void> {
    await fs.mkdir(path.dirname(at), { recursive: true })
    // skipInvalid drops the fields left `undefined`.
    await fs.writeFile(at, yaml.dump(cfg, { skipInvalid: true }), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    // `mode` applies only when the file is created.
    await fs.chmod(at, 0o600)
  }

  const currentApi = () => normalizedApi(deps.apiUrl())

  async function forget(account: string | undefined) {
    // Only the packaged app made the item, so only it may remove it.
    if (!account || !deps.secure()) return
    try {
      await deps.store.delete(account)
    } catch (e) {
      console.warn('auth: failed to remove the session token from the keychain', e)
    }
  }

  // Every read and write of the file runs one at a time, each from the file as
  // its turn finds it: a read that moves a plaintext token to the keychain can
  // then never land after, and undo, a sign-out or a newer sign-in.
  let queue: Promise<unknown> = Promise.resolve()

  function inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)

    queue = run.catch(() => null)

    return run
  }

  async function tokenOf(account: StoredAccount): Promise<string | null> {
    if (account.token) return account.token
    if (!account.keychainAccount || !deps.secure()) return null

    return deps.store.get(account.keychainAccount).catch((e: unknown) => {
      console.warn('auth: failed to read the session token from the keychain', e)

      return null
    })
  }

  /** Moves the token into the keychain item `item`; `active` then only names it. */
  async function intoKeychain(active: Config, item: string, token: string, had?: string) {
    try {
      // Update in place only an item this app made: one that was already
      // there could carry another app's access (a pre-created item, as in
      // the XARA attacks), so it is replaced.
      if (had !== item) await deps.store.delete(item).catch(() => null)
      await deps.store.set(item, token)
      active.token = undefined
      active.keychainAccount = item
    } catch (e) {
      // Still signed in, only less safely.
      console.warn(`auth: keeping the session token in ${deps.path} instead`, e)
    }
  }

  /** Makes `cfg` the active account (none without a token); one signed in before it waits. */
  async function save(cfg: Config): Promise<void> {
    const previous = (await readFile(deps.path)) ?? {}
    const api = currentApi()
    // One item per user and backend, so a dev backend's sign-in never replaces Nuphos Cloud's.
    const item = accountKey(api, cfg.userInfo)
    const active: Config = { ...stored(cfg, api), api, keychainAccount: undefined }
    const others = cfg.token
      ? waiting(previous.accounts ?? [], previous, item, api)
      : (previous.accounts ?? [])

    if (cfg.token && deps.secure())
      await intoKeychain(active, item, cfg.token, previous.keychainAccount)
    // A sign-in that now waits in the list keeps its item.
    const kept = others.some((a) => a.keychainAccount === previous.keychainAccount)

    if (previous.keychainAccount !== active.keychainAccount && !kept)
      await forget(previous.keychainAccount)
    await writeFile(deps.path, { ...(cfg.token ? active : {}), accounts: listed(others) })
    deps.onAccount(api, cfg.token ?? null, cfg.userInfo?.id ?? null)
  }

  /** Makes a waiting account the active one, on its own backend. */
  async function switchTo(key: string): Promise<void> {
    const previous = (await readFile(deps.path)) ?? {}
    const api = currentApi()
    const others = previous.accounts ?? []
    const target = others.find((a) => keyOf(a, api) === key)

    if (!target) throw new Error('That account is not signed in on this computer')
    const token = await tokenOf(target)

    if (!token) throw new Error('Sign in to that account again')
    const rest = waiting(others, previous, key, api)

    await writeFile(deps.path, { ...target, accounts: listed(rest) })
    deps.onAccount(target.api ?? api, token, target.userInfo?.id ?? null)
  }

  /** Signs a waiting account out of this app; its token is returned to end it on its backend. */
  async function forgetAccount(key: string): Promise<{ api: string; token: string } | null> {
    const previous = (await readFile(deps.path)) ?? {}
    const api = currentApi()
    const others = previous.accounts ?? []
    const target = others.find((a) => keyOf(a, api) === key)

    if (!target) return null
    const token = await tokenOf(target)
    const rest = others.filter((a) => a !== target)

    await writeFile(deps.path, { ...previous, accounts: listed(rest) })
    await forget(target.keychainAccount)

    return token ? { api: target.api ?? api, token } : null
  }

  /** Moves the active account, issued by `api`, to the list: signed in, but not in use. */
  async function park(api: string): Promise<void> {
    const previous = (await readFile(deps.path)) ?? {}
    const others = waiting(previous.accounts ?? [], previous, '', normalizedApi(api))

    await writeFile(deps.path, { accounts: listed(others) })
  }

  async function list(): Promise<AccountSummary[]> {
    const cfg = (await readFile(deps.path)) ?? {}

    return summaries(cfg, cfg.accounts ?? [], currentApi())
  }

  /**
   * Before this app had its own file it shared cli.yaml with the CLI: start
   * from that sign-in, once. Where the token goes to the keychain it leaves
   * cli.yaml as well, and `nuphos login` then takes it from here.
   */
  async function adopt(): Promise<Config | null> {
    const legacy = deps.legacyPath ? await readFile(deps.legacyPath) : null

    if (!deps.legacyPath || !legacy?.token) return null
    const cfg = {
      token: legacy.token,
      user: legacy.user,
      username: legacy.username,
      userInfo: legacy.userInfo,
    }

    await save(cfg)
    if (deps.secure()) await writeFile(deps.legacyPath, { ...legacy, token: undefined })

    return cfg
  }

  async function load(): Promise<Config> {
    const cfg = await readFile(deps.path)

    if (!cfg) return (await adopt().catch(() => null)) ?? {}
    if (cfg.token) {
      // Signed in before the keychain, or by a client without it: move it there.
      if (deps.secure())
        await save(cfg).catch((e: unknown) => {
          console.warn('auth: failed to move the session token to the keychain', e)
        })

      return cfg
    }
    // Only the packaged app may read the item it made: a dev build or plain
    // Node (tests, `pnpm test` in a shell) is another binary, and macOS would
    // ask for the login keychain password.
    if (!cfg.keychainAccount || !deps.secure()) return cfg
    const token = await deps.store.get(cfg.keychainAccount).catch((e: unknown) => {
      // Locked or denied: signed out for now, without forgetting the sign-in.
      console.warn('auth: failed to read the session token from the keychain', e)

      return null
    })

    return token ? { ...cfg, token } : cfg
  }

  return {
    read: () => inTurn(load),
    write: (cfg: Config) => {
      // A sign-out takes effect in memory at once, before its turn.
      if (!cfg.token) deps.onAccount(currentApi(), null, null)

      return inTurn(() => save(cfg))
    },
    switchTo: (key: string) => inTurn(() => switchTo(key)),
    forgetAccount: (key: string) => inTurn(() => forgetAccount(key)),
    park: (api: string) => inTurn(() => park(api)),
    list: () => inTurn(list),
  }
}

const defaultConfigFile = configFile({
  path: DESKTOP_CONFIG_PATH,
  legacyPath: CLI_CONFIG_PATH,
  store: keychainStore,
  secure: () => secureStorageEnabled(),
  apiUrl,
  onAccount: useAccount,
})

export const readConfig = defaultConfigFile.read
export const writeConfig = defaultConfigFile.write
export const switchAccountConfig = defaultConfigFile.switchTo
export const forgetAccountConfig = defaultConfigFile.forgetAccount
export const listAccountConfigs = defaultConfigFile.list
export const parkAccountConfig = defaultConfigFile.park

/**
 * The account a request goes out as: one context, so its backend, token and
 * signal always belong together. Until the startup check has run the token
 * comes from the file; once anything has set the session, only from memory.
 */
export async function requestContext(): Promise<AccountContext> {
  const ctx = authSession.context()

  if (ctx.token || authSession.settled()) return ctx
  const { token } = await readConfig()
  const now = authSession.context()

  return now === ctx && token ? { ...ctx, token } : now
}

export async function apiErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null

  return typeof body?.error?.message === 'string'
    ? body.error.message
    : `HTTP ${String(res.status)}`
}
