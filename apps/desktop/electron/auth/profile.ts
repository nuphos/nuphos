import { isValidUserInfo } from '../auth-status.ts'

import { apiErrorMessage, NUPHOS_URL, readConfig, writeConfig } from './config.ts'

export type ProfileUpdate = { name: string; username: string; avatarURL: string }

export async function updateProfile(input: ProfileUpdate) {
  const cfg = await readConfig()

  if (!cfg.token) throw new Error('Please sign in again')
  const res = await fetch(`${NUPHOS_URL}/auth/me`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(await apiErrorMessage(res))
  const user: unknown = await res.json()

  if (!isValidUserInfo(user)) throw new Error('Malformed profile response')
  const current = await readConfig()

  if (current.token !== cfg.token) throw new Error('Your sign-in changed; reopen profile settings')
  await writeConfig({ ...current, user: user.name, username: user.username, userInfo: user })

  return user
}
