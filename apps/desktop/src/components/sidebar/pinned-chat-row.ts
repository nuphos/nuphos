import type { Item } from './types'

/**
 * What a pinned chat takes from its live row, so it reads and acts the same in
 * Pinned: its threads, status, actions and what the viewer may do with it.
 */
export function pinnedChatFields(live: Item | undefined) {
  return {
    parentKey: live?.parentKey,
    foldedStatus: live?.foldedStatus,
    dot: live?.dot,
    trailing: live?.trailing,
    actions: live?.actions,
    watching: live?.watching,
    description: live?.description,
    readOnlyChat: live?.readOnlyChat,
    managedChat: live?.managedChat,
  }
}
