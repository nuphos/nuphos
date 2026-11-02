import { authSession } from '../auth-session.ts'
import { isValidUserInfo } from '../auth-status.ts'

import { commitConfigIf, readConfig } from './config.ts'
import { apiErrorMessage } from './web.ts'

export type ProfileUpdate = { name: string; username: string; avatarURL: string }

export function updateProfile(input: ProfileUpdate) {
  return sendProfileRequest('/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Uploads an already-cropped image; the backend re-encodes it to a 256px WebP. */
export function uploadAvatar(image: Uint8Array) {
  return sendProfileRequest('/auth/me/avatar', {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: image,
  })
}

export function removeAvatar() {
  return sendProfileRequest('/auth/me/avatar', { method: 'DELETE' })
}

async function sendProfileRequest(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array },
) {
  const start = authSession.context()
  const read = await readConfig()
  const cfg = { ...read, api: read.api ?? start.api }

  if (!cfg.token) throw new Error('Please sign in again')
  const res = await fetch(`${cfg.api}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(await apiErrorMessage(res))
  const user: unknown = await res.json()

  if (!isValidUserInfo(user)) throw new Error('Malformed profile response')
  // Written in the file's turn, and only if no switch, sign-in or sign-out
  // landed meanwhile: this profile is the account it was asked as.
  const saved = await commitConfigIf(
    () => authSession.context().epoch === start.epoch,
    async (save) => {
      await save({ ...cfg, user: user.name, username: user.username, userInfo: user })

      return true
    },
  )

  if (!saved) throw new Error('Your sign-in changed; reopen profile settings')

  return user
}
