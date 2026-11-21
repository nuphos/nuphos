import { call } from '../atlas/client.ts'

import { callJson, callJsonForRenderer, teamQuery } from './http'

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

/** The owner rewrites a Bot's standing instructions; empty clears them. */
export async function setBotInstructions(
  sessionId: string,
  instructions: string,
  teamId?: string,
): Promise<{ instructions: string }> {
  // A refusal's reason shows under the field, so its code has to survive IPC.
  return callJsonForRenderer(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/instructions${teamQuery(teamId)}`,
    { instructions },
  )
}

/** The owner starts a Bot fresh: its next turn opens a new session with a summary of this one. */
export async function startBotFresh(
  sessionId: string,
  teamId?: string,
): Promise<{ at: string; messageCount: number }> {
  // A refusal (it is replying) is the backend's to word, so its code has to survive IPC.
  return callJsonForRenderer(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/start-fresh${teamQuery(teamId)}`,
    {},
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
