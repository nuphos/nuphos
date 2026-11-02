import { apiUrl, keepBackend, useAccount } from '../api-endpoint.ts'
import { authSession } from '../auth-session.ts'
import { CLI_CONFIG_PATH, DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

import { accountKey, keyOf, normalizedApi, stored, summaries, waiting } from './accounts.ts'
import { keychainStore, secureStorageEnabled } from './token-store.ts'
import { readYaml, writeYaml } from './yaml-file.ts'

import type { AccountContext } from '../auth-session.ts'
import type { UserInfo } from '../auth-status.ts'
import type { AccountSummary, StoredAccount } from './accounts.ts'
import type { TokenStore } from './token-store.ts'

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
  /** The account now signed in, with its backend, in memory. */
  onAccount: (api: string, token: string | null, userId: string | null) => void
  /** Saves the backend for the next launch and the CLI; throws if it cannot. */
  keepBackend: (api: string) => void
  /** The CLI's cli.yaml, which this app shared before it had its own file. */
  legacyPath?: string
}

// No empty list in the file.
const listed = (accounts: StoredAccount[]) => (accounts.length > 0 ? accounts : undefined)

/** This app's sign-in file, with its token in the keychain where there is one. */
export function configFile(deps: ConfigFileDeps) {
  const readFile = (at: string) => readYaml<Config>(at)
  const writeFile = writeYaml

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

    // A token stays with the backend that issued it; it is never relabelled.
    if (cfg.token && cfg.api && normalizedApi(cfg.api) !== api)
      throw new Error('This sign-in belongs to another backend')
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
    const to = target.api ?? api

    // Two files change: the backend first, so a failure there changes nothing,
    // and back again if the account file then fails. A crash in between is
    // caught at the next read (see `load`).
    deps.keepBackend(to)
    try {
      await writeFile(deps.path, { ...target, accounts: listed(rest) })
    } catch (e) {
      deps.keepBackend(api)
      throw e
    }
    deps.onAccount(to, token, target.userInfo?.id ?? null)
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
    // An account issued by another backend than the current one is never used
    // here: it waits in the list, still signed in there.
    if (cfg.api && normalizedApi(cfg.api) !== currentApi() && (cfg.token || cfg.keychainAccount)) {
      await park(cfg.api)

      return (await readFile(deps.path)) ?? {}
    }
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
    /**
     * Runs `task` in the file's turn only if `isCurrent` still holds when the
     * turn comes, so work begun as one account never commits after another
     * took over. `null` when it did not run; `save` writes without queueing.
     */
    commitIf: <T>(
      isCurrent: () => boolean,
      task: (save: (cfg: Config) => Promise<void>) => Promise<T>,
    ): Promise<T | null> => inTurn(async () => (isCurrent() ? await task(save) : null)),
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
  keepBackend,
})

export const readConfig = defaultConfigFile.read
export const writeConfig = defaultConfigFile.write
export const commitConfigIf = defaultConfigFile.commitIf
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
