// The accounts in this app's sign-in file: the current one at the top level,
// where skill scripts and older builds read it, and the others signed in on
// this device in `otherAccounts`, each shaped the same way.

import fs from 'node:fs/promises'
import path from 'node:path'

import yaml from 'js-yaml'

import type { UserInfo } from '../auth-status.ts'

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
  /** The backend this sign-in belongs to. */
  apiUrl?: string
  /** The other accounts signed in on this device, each shaped like this one. */
  otherAccounts?: Config[]
}

/** A signed-in account other than the current one, without its token. */
export type OtherAccount = { key: string; user?: UserInfo; apiUrl?: string }

export async function readFile(at: string): Promise<Config | null> {
  try {
    return (yaml.load(await fs.readFile(at, 'utf-8')) as Config | null) ?? {}
  } catch {
    return null
  }
}

export async function writeFile(at: string, cfg: Config): Promise<void> {
  await fs.mkdir(path.dirname(at), { recursive: true })
  // skipInvalid drops the fields left `undefined`.
  await fs.writeFile(at, yaml.dump(cfg, { skipInvalid: true }), {
    encoding: 'utf-8',
    mode: 0o600,
  })
  // `mode` applies only when the file is created.
  await fs.chmod(at, 0o600)
}

export function normalizedApi(url: string): string {
  let api = url.trim()

  while (api.endsWith('/')) api = api.slice(0, -1)

  return api
}

/** One item per user and backend, so a dev backend's sign-in never replaces Nuphos Cloud's. */
export function itemFor(cfg: Config, api: string): string {
  return `${cfg.userInfo?.id ?? 'default'}@${api}`
}

/** Names an account in the list: its keychain item, or the item it would have. */
export function accountKey(cfg: Config, currentApi: string): string | undefined {
  if (cfg.keychainAccount) return cfg.keychainAccount
  if (!cfg.token) return undefined

  return itemFor(cfg, cfg.apiUrl ?? currentApi)
}

/** Whether two reads of the sign-in file name the same account. */
export function sameAccount(a: Config, b: Config, currentApi: string): boolean {
  const api = normalizedApi(currentApi)

  return accountKey(a, api) === accountKey(b, api)
}

/** The current account as an entry in the list, or nothing when signed out. */
export function listedAs(cfg: Config, currentApi: string): Config | null {
  if (!accountKey(cfg, currentApi)) return null
  const { otherAccounts: _, ...account } = cfg
  const at = cfg.keychainAccount?.indexOf('@') ?? -1

  return {
    ...account,
    apiUrl: cfg.apiUrl ?? (at > 0 ? cfg.keychainAccount?.slice(at + 1) : currentApi),
  }
}

/** The keychain items an account file names. */
export function itemsOf(cfg: Config): Set<string> {
  const items = [cfg, ...(cfg.otherAccounts ?? [])].map((c) => c.keychainAccount)

  return new Set(items.filter((item): item is string => Boolean(item)))
}
