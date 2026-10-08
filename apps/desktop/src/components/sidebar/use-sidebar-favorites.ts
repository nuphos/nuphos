import { useCallback, useEffect, useState } from 'react'

import {
  addSidebarFavorite,
  favoriteIdentity,
  readSidebarFavorites,
  removeSidebarFavorite,
  subscribeSidebarFavorites,
  syncSidebarFavorites,
} from '../../lib/sidebarFavorites'
import { AGENT_SESSION_KEY_PREFIX, favoriteSessionId } from '../../lib/sidebarPinnedChats'
import {
  renamedTeamNavKey,
  renamedTeamPagePath,
  teamOverviewNavItemFor,
} from '../../lib/teamOverviewNav'

import { favoriteFallbackIcon } from './types'

import type { Item, Section } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'
import type { ReactNode } from 'react'

export function useSidebarFavorites({
  userId,
  teamId,
  teamView,
  sections,
  currentHref,
  activeSessionId,
  scopeChipForPath,
  onOpenPath,
  onOpenKey,
}: {
  userId: string
  teamId: string
  teamView: boolean
  sections: Section[]
  currentHref: string | null
  /** The conversation open in the main pane, which a pinned chat row tracks. */
  activeSessionId?: string | null
  scopeChipForPath?: (href: string) => { label: string; icon: ReactNode } | null
  onOpenPath?: (href: string, label: string, newTab: boolean) => void
  onOpenKey?: (key: string, favoriteLabel: string | null, newTab: boolean) => void
}) {
  const [favorites, setFavorites] = useState<SidebarFavorite[]>(() =>
    readSidebarFavorites(userId, teamId),
  )
  // Re-seed team-scoped state on team switch during render — the documented
  // "storing information from previous renders" pattern (cf. SidebarNavStack).
  const [seededTeamId, setSeededTeamId] = useState(teamId)

  if (seededTeamId !== teamId) {
    setSeededTeamId(teamId)
    setFavorites(readSidebarFavorites(userId, teamId))
  }
  // Tabs add favorites too (right-click → Add to Favorites); stay in sync.
  useEffect(() => {
    void syncSidebarFavorites(userId, teamId)

    return subscribeSidebarFavorites(userId, teamId, () =>
      setFavorites(readSidebarFavorites(userId, teamId)),
    )
  }, [teamId, userId])

  // A row with an href pins as an href entry — the same identity a workspace
  // tab produces for that page. Rows without one (no route to derive) still pin
  // by key.
  const favoriteEntryForItem = useCallback(
    (item: Item): SidebarFavorite =>
      item.href ? { label: item.label, href: item.href } : { label: item.label, key: item.key },
    [],
  )

  // Matches either identity, so a pin made before this row gained an href — or
  // from the other surface — is still recognised and removable.
  const favoriteMatch = useCallback(
    (item: Item) => {
      const identity = favoriteIdentity(favoriteEntryForItem(item))

      return favorites.find((entry) => {
        const entryIdentity = favoriteIdentity(entry)

        return entryIdentity === identity || entryIdentity === item.key
      })
    },
    [favoriteEntryForItem, favorites],
  )

  // Overview pages are already permanently in the sidebar, so pinning one only
  // duplicates a row. Favorites is for what the sidebar can't otherwise reach:
  // chats, drill-downs, and pages captured from a tab. Pins made before this
  // rule keep their control so they can still be removed.
  const canFavorite = useCallback(
    (item: Item) =>
      teamView &&
      item.enabled &&
      (!teamOverviewNavItemFor(item.key) || Boolean(favoriteMatch(item))),
    [favoriteMatch, teamView],
  )

  const toggleFavorite = useCallback(
    (item: Item) => {
      // The change event feeds back into state.
      const existing = favoriteMatch(item)

      if (existing) removeSidebarFavorite(userId, teamId, favoriteIdentity(existing))
      else addSidebarFavorite(userId, teamId, favoriteEntryForItem(item))
    },
    [favoriteEntryForItem, favoriteMatch, teamId, userId],
  )

  // Resolve favorites against the live items so labels/active state stay
  // fresh; entries whose source left the list fall back to their snapshot.
  const liveItemsByKey = new Map<string, Item>()
  const liveItemsByHref = new Map<string, Item>()

  for (const section of sections) {
    for (const item of section.items) {
      liveItemsByKey.set(item.key, item)
      if (item.href) liveItemsByHref.set(item.href, item)
    }
  }
  const resolveFavorite = (entry: SidebarFavorite): Item => {
    const identity = favoriteIdentity(entry)

    if (entry.href) {
      const href = renamedTeamPagePath(entry.href)
      const live = liveItemsByHref.get(href)
      const sessionId = favoriteSessionId(entry)
      // "Monitors" alone doesn't say which BetterStack instance it belongs to,
      // and two instances would produce two identical rows. Qualify with the
      // scope, and take its logo as the row icon.
      const chip = scopeChipForPath?.(href) ?? null
      const liveLabel = live?.label ?? entry.label
      const label = chip ? `${chip.label} · ${liveLabel}` : liveLabel

      return {
        key: identity,
        label,
        icon:
          chip || live?.iconNode ? undefined : (live?.icon ?? favoriteFallbackIcon(identity, href)),
        iconNode: chip?.icon ?? live?.iconNode,
        trailing: live?.trailing,
        enabled: true,
        active: sessionId
          ? sessionId === activeSessionId
          : currentHref != null && currentHref === href,
        // A pinned chat opens like any chat row — in the main pane, not by
        // retargeting the dock tab.
        onActivate: sessionId
          ? onOpenKey &&
            ((newTab) => onOpenKey(`${AGENT_SESSION_KEY_PREFIX}${sessionId}`, label, newTab))
          : onOpenPath && ((newTab) => onOpenPath(href, label, newTab)),
      }
    }
    const key = entry.key && renamedTeamNavKey(entry.key)
    const live = key ? liveItemsByKey.get(key) : undefined
    // A favorite opens its page in its own tab rather than replacing whatever
    // the user is looking at, matching how href favorites already behave.
    const label = live?.label ?? entry.label
    const onActivate =
      onOpenKey && key ? (newTab: boolean) => onOpenKey(key, label, newTab) : undefined

    // No trailing archive control on favorite rows — a favorite is an explicit
    // pin, and archiving from here while the pin stays would look like a no-op.
    return live
      ? { ...live, actions: undefined, onActivate }
      : {
          onActivate,
          key: identity,
          label: entry.label,
          icon: favoriteFallbackIcon(identity),
          enabled: true,
        }
  }
  // Pinned chats get their own list above Chats; everything else stays in the
  // generic Favorites group.
  const favoriteItems: Item[] = []
  const pinnedChatItems: Item[] = []

  for (const entry of favorites) {
    ;(favoriteSessionId(entry) ? pinnedChatItems : favoriteItems).push(resolveFavorite(entry))
  }

  return { favoriteMatch, canFavorite, toggleFavorite, favoriteItems, pinnedChatItems }
}
