import fs from 'node:fs/promises'
import path from 'node:path'

import yaml from 'js-yaml'

import { authSession } from '../auth-session.ts'
import { CLI_CONFIG_PATH } from '../cli-config-path.ts'

import type { UserInfo } from '../auth-status.ts'

export const NUPHOS_LOGIN_URL =
  process.env.NUPHOS_LOGIN_URL ||
  (process.env.NUPHOS_WEB_URL
    ? new URL('/login', process.env.NUPHOS_WEB_URL).toString()
    : 'https://nuphos.ai/login')

export type Config = {
  token?: string
  user?: string
  username?: string
  // Full identity from the last successful /auth/me, so a transient failure at
  // startup can keep the session alive instead of looking like a logout.
  userInfo?: UserInfo
}

export async function readConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CLI_CONFIG_PATH, 'utf-8')

    return (yaml.load(data) as Config) || {}
  } catch {
    return {}
  }
}

export async function writeConfig(cfg: Config) {
  if (!cfg.token) authSession.set(null)
  await fs.mkdir(path.dirname(CLI_CONFIG_PATH), { recursive: true })
  await fs.writeFile(CLI_CONFIG_PATH, yaml.dump(cfg), { encoding: 'utf-8', mode: 0o600 })
  // `mode` applies only when the file is created.
  await fs.chmod(CLI_CONFIG_PATH, 0o600)
  authSession.set(cfg.token ?? null)
}

export async function apiErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null

  return typeof body?.error?.message === 'string'
    ? body.error.message
    : `HTTP ${String(res.status)}`
}
