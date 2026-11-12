import { useSyncExternalStore } from 'react'

/** The Bot whose face is being picked again, and the name it is shown with. */
export type ChangeBotAvatarRequest = {
  teamId: string
  botId: string
  title?: string
}

let request: ChangeBotAvatarRequest | null = null
const listeners = new Set<() => void>()

function publish(next: ChangeBotAvatarRequest | null) {
  request = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** Opens the face picker (ChangeBotAvatarHost) for one Bot, from any menu or header. */
export function openChangeBotAvatar(next: ChangeBotAvatarRequest) {
  publish(next)
}

export function closeChangeBotAvatar() {
  publish(null)
}

export function useChangeBotAvatarRequest(): ChangeBotAvatarRequest | null {
  return useSyncExternalStore(subscribe, () => request)
}
