import { useEffect, useSyncExternalStore } from 'react'

import { jumpTo } from '../agent/panel/jumpTo'

/** The post a channel opens at, by channel: set just before a link to that post opens it. */
const jumps = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Opens the channel's next view at this post rather than at its bottom. */
export function openChannelAtPost(channelId: string, postId: string) {
  jumps.set(channelId, postId)
  for (const listener of listeners) listener()
}

/** The post the channel is to open at, until it is taken. */
export function usePostJump(channelId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => jumps.get(channelId))
}

/**
 * Opened from a link to a post: the drawn chat goes there once it has settled
 * at its bottom. A post no longer loaded leaves it at its bottom.
 */
export function useOpenAtPost(channelId: string) {
  const postId = usePostJump(channelId)

  useEffect(() => {
    if (!postId) return
    jumps.delete(channelId)
    requestAnimationFrame(() => jumpTo(postId))
  }, [postId, channelId])
}
