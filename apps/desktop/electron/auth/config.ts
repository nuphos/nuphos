import { apiUrl, setApiUrl } from '../api-endpoint.ts'
import { authSession } from '../auth-session.ts'
import { CLI_CONFIG_PATH, DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

import {
  accountKey,
  itemFor,
  itemsOf,
  listedAs,
  normalizedApi,
  readFile,
  writeFile,
} from './accounts.ts'
import { keychainStore, secureStorageEnabled } from './token-store.ts'

import type { Config, OtherAccount } from './accounts.ts'
import type { TokenStore } from './token-store.ts'

export type { Config, OtherAccount }

export const NUPHOS_LOGIN_URL =
  process.env.NUPHOS_LOGIN_URL ||
  (process.env.NUPHOS_WEB_URL
    ? new URL('/login', process.env.NUPHOS_WEB_URL).toString()
    : 'https://nuphos.ai/login')

type ConfigFileDeps = {
  path: string
  store: TokenStore
  secure: () => boolean
  apiUrl: () => string
  /** Points the app at another backend, when switching to an account there. */
  setApiUrl?: (url: string) => void
  onToken: (token: string | null) => void
  /** The CLI's cli.yaml, which this app shared before it had its own file. */
  legacyPath?: string
}

/** This app's sign-in file, with its token in the keychain where there is one. */
export function configFile(deps: ConfigFileDeps) {
  const currentApi = () => normalizedApi(deps.apiUrl())
  const keyOf = (cfg: Config) => accountKey(cfg, currentApi())
  const asOther = (cfg: Config) => listedAs(cfg, currentApi())

  /** Removes the keychain items `before` named that `after` no longer does. */
  async function forgetDropped(before: Config, after: Config) {
    const kept = itemsOf(after)

    for (const item of itemsOf(before)) if (!kept.has(item)) await forget(item)
  }

  async function tokenOf(cfg: Config): Promise<string | null> {
    if (cfg.token) return cfg.token
    if (!cfg.keychainAccount) return null

    return deps.store.get(cfg.keychainAccount).catch((e: unknown) => {
      // Locked or denied: signed out for now, without forgetting the sign-in.
      console.warn('auth: failed to read the session token from the keychain', e)

      return null
    })
  }

  async function forget(account: string | undefined) {
    if (!account) return
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

  /**
   * Makes `cfg` the current account, or signs the current one out when it has
   * no token. A sign-in as someone else keeps the previous account in the
   * list, so switching back needs no new sign-in.
   */
  async function save(cfg: Config): Promise<void> {
    const previous = (await readFile(deps.path)) ?? {}
    const stored: Config = { ...cfg, keychainAccount: undefined, otherAccounts: undefined }
    let others = previous.otherAccounts ?? []

    // A sign-in made on another backend (adding an account there) moves the
    // app to it together with the token, never before.
    const api = cfg.apiUrl ? normalizedApi(cfg.apiUrl) : currentApi()

    if (cfg.token) {
      const account = itemFor(cfg, api)
      const before = asOther(previous)

      stored.apiUrl = api
      // Signing in again to a listed account takes it out of the list.
      others = others.filter((other) => keyOf(other) !== account)
      if (before && keyOf(before) !== account) others = [before, ...others]
      if (deps.secure()) {
        try {
          // Update in place only an item this app made: one that was already
          // there could carry another app's access (a pre-created item, as in
          // the XARA attacks), so it is replaced.
          if (!itemsOf(previous).has(account))
            await deps.store.delete(account).catch(() => undefined)
          await deps.store.set(account, cfg.token)
          stored.token = undefined
          stored.keychainAccount = account
        } catch (e) {
          // Still signed in, only less safely.
          console.warn(`auth: keeping the session token in ${deps.path} instead`, e)
        }
      }
    }
    const next: Config = cfg.token ? stored : {}

    if (others.length > 0) next.otherAccounts = others
    await forgetDropped(previous, next)
    await writeFile(deps.path, next)
    if (cfg.token && api !== currentApi()) deps.setApiUrl?.(api)
    deps.onToken(cfg.token ?? null)
  }

  /** Makes a listed account the current one, keeping the current one in the list. */
  async function switchTo(key: string): Promise<Config> {
    const previous = (await readFile(deps.path)) ?? {}
    const others = previous.otherAccounts ?? []
    const target = others.find((other) => keyOf(other) === key)

    if (!target) throw new Error('That account is no longer signed in on this device')
    const before = asOther(previous)
    const rest = others.filter((other) => other !== target)
    const next: Config = { ...target, otherAccounts: before ? [before, ...rest] : rest }

    if (next.otherAccounts?.length === 0) delete next.otherAccounts
    await writeFile(deps.path, next)
    // Point at the account's backend before anything uses its token there.
    if (target.apiUrl && target.apiUrl !== currentApi()) deps.setApiUrl?.(target.apiUrl)
    const token = await tokenOf(target)

    deps.onToken(token)
    const { otherAccounts: _, ...current } = next

    return token ? { ...current, token } : current
  }

  /** Signs every account on this device out. */
  async function forgetAll(): Promise<void> {
    const previous = (await readFile(deps.path)) ?? {}

    await forgetDropped(previous, {})
    await writeFile(deps.path, {})
    deps.onToken(null)
  }

  async function listOthers(): Promise<OtherAccount[]> {
    const cfg = (await readFile(deps.path)) ?? {}

    return (cfg.otherAccounts ?? []).flatMap((other) => {
      const key = keyOf(other)

      return key ? [{ key, user: other.userInfo, apiUrl: other.apiUrl }] : []
    })
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
    const file = await readFile(deps.path)

    if (!file) return (await adopt().catch(() => null)) ?? {}
    const { otherAccounts: _, ...cfg } = file

    if (cfg.token) {
      // Signed in before the keychain, or by a client without it: move it there.
      if (deps.secure())
        await save(file).catch((e: unknown) => {
          console.warn('auth: failed to move the session token to the keychain', e)
        })

      return cfg
    }
    const token = await tokenOf(cfg)

    return token ? { ...cfg, token } : cfg
  }

  return {
    read: () => inTurn(load),
    write: (cfg: Config) => {
      // A sign-out takes effect in memory at once, before its turn.
      if (!cfg.token) deps.onToken(null)

      return inTurn(() => save(cfg))
    },
    switchTo: (key: string) => inTurn(() => switchTo(key)),
    signOutAll: () => {
      deps.onToken(null)

      return inTurn(forgetAll)
    },
    others: () => inTurn(listOthers),
  }
}

const defaultConfigFile = configFile({
  path: DESKTOP_CONFIG_PATH,
  legacyPath: CLI_CONFIG_PATH,
  store: keychainStore,
  secure: () => secureStorageEnabled(),
  apiUrl,
  setApiUrl,
  onToken: (token) => {
    authSession.set(token)
  },
})

export const readConfig = defaultConfigFile.read
export const writeConfig = defaultConfigFile.write
export const switchConfig = defaultConfigFile.switchTo
export const signOutAllConfig = defaultConfigFile.signOutAll
export const otherAccounts = defaultConfigFile.others

/** The signed-in token, kept in memory once the startup check has run. */
export async function sessionToken(): Promise<string | null> {
  return authSession.current() ?? (await readConfig()).token ?? null
}

export async function apiErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null

  return typeof body?.error?.message === 'string'
    ? body.error.message
    : `HTTP ${String(res.status)}`
}
