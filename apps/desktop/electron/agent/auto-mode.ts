import { callJson } from './http'

// Full Access: the per-conversation switch that stops asking for permission.
export async function getAutoModeBypass(
  sessionId: string,
): Promise<{ enabled: boolean; bypass: boolean }> {
  return callJson<{ enabled: boolean; bypass: boolean }>(
    'GET',
    `/agent/auto-mode/bypass?sessionId=${encodeURIComponent(sessionId)}`,
  )
}
export async function setAutoModeBypass(
  sessionId: string,
  bypass: boolean,
): Promise<{ ok: boolean; bypass: boolean }> {
  return callJson<{ ok: boolean; bypass: boolean }>('PUT', `/agent/auto-mode/bypass`, {
    sessionId,
    bypass,
  })
}
