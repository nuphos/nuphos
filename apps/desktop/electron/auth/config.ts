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
  // The token last read or written, valid while the file is unchanged, so
  // reading the config per request does not reach the keychain each time.
  let cached: { stamp: string; account: string; token: string } | null = null

  async function readFile(): Promise<{ cfg: Config; stamp: string; exists: boolean }> {
    try {
      const [data, stat] = await Promise.all([fs.readFile(deps.path, 'utf-8'), fs.stat(deps.path)])

      return {
        cfg: (yaml.load(data) as Config | null) || {},
        stamp: `${String(stat.mtimeMs)}:${data}`,
        exists: true,
      }
    } catch {
      return { cfg: {}, stamp: '', exists: false }
    }
  }

  async function writeFile(cfg: Config): Promise<string> {
    // skipInvalid drops the fields left `undefined`.
    const data = yaml.dump(cfg, { skipInvalid: true })

    await fs.mkdir(path.dirname(deps.path), { recursive: true })
    await fs.writeFile(deps.path, data, { encoding: 'utf-8', mode: 0o600 })
    // `mode` applies only when the file is created.
    await fs.chmod(deps.path, 0o600)

    return `${String((await fs.stat(deps.path)).mtimeMs)}:${data}`
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

  async function write(cfg: Config): Promise<void> {
    if (!cfg.token) deps.onToken(null)
    const { cfg: previous, stamp } = await readFile()
    const stored: Config = { ...cfg, keychainAccount: undefined }

    if (cfg.token && deps.secure()) {
      const account = accountFor(cfg)
      const unchanged =
        cached?.stamp === stamp && cached.account === account && cached.token === cfg.token

      try {
        // Update in place only an item this app made: one that was already
        // there could carry another app's access (a pre-created item, as in
        // the XARA attacks), so it is replaced.
        if (previous.keychainAccount !== account)
          await deps.store.delete(account).catch(() => undefined)
        if (!unchanged) await deps.store.set(account, cfg.token)
        stored.token = undefined
        stored.keychainAccount = account
      } catch (e) {
        // Still signed in, only less safely.
        console.warn(`auth: keeping the session token in ${deps.path} instead`, e)
      }
    }
    if (previous.keychainAccount !== stored.keychainAccount) await forget(previous.keychainAccount)
    cached = null
    const written = await writeFile(cfg.token ? stored : {})

    if (cfg.token && stored.keychainAccount) {
      cached = { stamp: written, account: stored.keychainAccount, token: cfg.token }
    }
    deps.onToken(cfg.token ?? null)
  }

  /**
   * Before this app had its own file it shared cli.yaml with the CLI: start
   * from that sign-in, once. Where the token goes to the keychain it leaves
   * cli.yaml as well, and `nuphos login` then takes it from here.
   */
  async function adopt(): Promise<boolean> {
    if (!deps.legacyPath) return false
    let legacy: Config

    try {
      legacy = (yaml.load(await fs.readFile(deps.legacyPath, 'utf-8')) as Config | null) ?? {}
    } catch {
      return false
    }
    if (!legacy.token) return false
    await write({
      token: legacy.token,
      user: legacy.user,
      username: legacy.username,
      userInfo: legacy.userInfo,
    })
    if (deps.secure()) {
      await fs.writeFile(
        deps.legacyPath,
        yaml.dump({ ...legacy, token: undefined }, { skipInvalid: true }),
        {
          encoding: 'utf-8',
          mode: 0o600,
        },
      )
    }

    return true
  }

  async function read(): Promise<Config> {
    const { cfg, stamp, exists } = await readFile()

    if (!exists && (await adopt().catch(() => false))) return read()
    if (cfg.token) {
      // Signed in before the keychain, or by a client without it: move it there.
      if (deps.secure()) {
        try {
          await write(cfg)
        } catch (e) {
          console.warn('auth: failed to move the session token to the keychain', e)
        }
      }

      return cfg
    }
    const account = cfg.keychainAccount

    if (!account) return cfg
    if (cached?.stamp === stamp && cached.account === account)
      return { ...cfg, token: cached.token }
    const token = await deps.store.get(account).catch((e: unknown) => {
      // Locked or denied: signed out for now, without forgetting the sign-in.
      console.warn('auth: failed to read the session token from the keychain', e)

      return null
    })

    if (!token) return cfg
    cached = { stamp, account, token }

    return { ...cfg, token }
  }

  return { read, write }
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

export async function apiErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null

  return typeof body?.error?.message === 'string'
    ? body.error.message
    : `HTTP ${String(res.status)}`
}
