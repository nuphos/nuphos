import fs from 'node:fs/promises'
import path from 'node:path'

import yaml from 'js-yaml'

import { apiUrl } from '../api-endpoint.ts'
import { authSession } from '../auth-session.ts'
import { CLI_CONFIG_PATH, DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

import { keychainStore, secureStorageEnabled } from './token-store.ts'

import type { UserInfo } from '../auth-status.ts'
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
}

type ConfigFileDeps = {
  path: string
  store: TokenStore
  secure: () => boolean
  apiUrl: () => string
  onToken: (token: string | null) => void
  /** The CLI's cli.yaml, which this app shared before it had its own file. */
  legacyPath?: string
}

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

  /** One item per user and backend, so a dev backend's sign-in never replaces Nuphos Cloud's. */
  function accountFor(cfg: Config): string {
    let api = deps.apiUrl().trim()

    while (api.endsWith('/')) api = api.slice(0, -1)

    return `${cfg.userInfo?.id ?? 'default'}@${api}`
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

  async function save(cfg: Config): Promise<void> {
    const previous = (await readFile(deps.path)) ?? {}
    const stored: Config = { ...cfg, keychainAccount: undefined }

    if (cfg.token && deps.secure()) {
      const account = accountFor(cfg)

      try {
        // Update in place only an item this app made: one that was already
        // there could carry another app's access (a pre-created item, as in
        // the XARA attacks), so it is replaced.
        if (previous.keychainAccount !== account)
          await deps.store.delete(account).catch(() => undefined)
        await deps.store.set(account, cfg.token)
        stored.token = undefined
        stored.keychainAccount = account
      } catch (e) {
        // Still signed in, only less safely.
        console.warn(`auth: keeping the session token in ${deps.path} instead`, e)
      }
    }
    if (previous.keychainAccount !== stored.keychainAccount) await forget(previous.keychainAccount)
    await writeFile(deps.path, cfg.token ? stored : {})
    deps.onToken(cfg.token ?? null)
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
    if (!cfg.keychainAccount) return cfg
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
      if (!cfg.token) deps.onToken(null)

      return inTurn(() => save(cfg))
    },
  }
}

const defaultConfigFile = configFile({
  path: DESKTOP_CONFIG_PATH,
  legacyPath: CLI_CONFIG_PATH,
  store: keychainStore,
  secure: () => secureStorageEnabled(),
  apiUrl,
  onToken: (token) => {
    authSession.set(token)
  },
})

export const readConfig = defaultConfigFile.read
export const writeConfig = defaultConfigFile.write

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
