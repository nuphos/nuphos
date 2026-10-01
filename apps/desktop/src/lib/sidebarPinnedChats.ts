import { navigationFromAppPath } from './appRoutes.ts'
import { HREF_FAVORITE_PREFIX } from './sidebar-favorites/store.ts'

import type { SidebarFavorite } from './sidebarFavorites.ts'

export const AGENT_SESSION_KEY_PREFIX = 'agent-session:'

/**
 * The conversation a favorite points at, whichever identity it was pinned
 * under: a sidebar chat row key, the app path a chat row / tab produces, or
 * the `fav-href:` row key a resolved favorite carries.
 */
export function favoriteSessionId(entry: Pick<SidebarFavorite, 'key' | 'href'>): string | null {
  if (entry.key?.startsWith(AGENT_SESSION_KEY_PREFIX)) {
    return entry.key.slice(AGENT_SESSION_KEY_PREFIX.length) || null
  }
  const href = entry.key?.startsWith(HREF_FAVORITE_PREFIX)
    ? entry.key.slice(HREF_FAVORITE_PREFIX.length)
    : entry.href

  if (!href) return null
  const navigation = navigationFromAppPath(href)

  return navigation?.active === 'team.agent' ? navigation.agentSessionId : null
}

export function partitionPinnedChats<T extends { entry: Pick<SidebarFavorite, 'key' | 'href'> }>(
  favorites: T[],
): { pinnedChats: T[]; others: T[] } {
  const pinnedChats: T[] = []
  const others: T[] = []

  for (const favorite of favorites) {
    ;(favoriteSessionId(favorite.entry) ? pinnedChats : others).push(favorite)
  }

  return { pinnedChats, others }
}
