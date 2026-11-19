import { call } from '../atlas/client.ts'

import { callJson, teamQuery } from './http'

export async function renameConversation(
  sessionId: string,
  title: string,
  teamId?: string,
): Promise<{ title: string }> {
  return callJson(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/title${teamQuery(teamId)}`,
    { title },
  )
}

/**
 * `avatar` is a bot-avatar name such as `05-rembrandt`; null returns to the derived one.
 * `background` is the tint it sits on (`none` clears it); left out, it stays.
 */
export async function setConversationAvatar(
  sessionId: string,
  avatar: string | null,
  teamId?: string,
  background?: string,
): Promise<{ avatar: string | null; background?: string }> {
  return callJson(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/avatar${teamQuery(teamId)}`,
    background ? { avatar, background } : { avatar },
  )
}

/** Uploads an already-cropped photo as a Bot's face (the backend re-encodes it). */
export async function uploadConversationAvatar(
  sessionId: string,
  image: Uint8Array,
  teamId?: string,
): Promise<{ avatar: string }> {
  return call(
    'PUT',
    `/agent/conversations/${encodeURIComponent(sessionId)}/avatar/image${teamQuery(teamId)}`,
    image,
    { retry: false },
  )
}
