import { useCallback, useEffect, useState } from 'react'

import {
  addSidebarFavorite,
  favoriteIdentity,
  readSidebarFavorites,
  removeSidebarFavorite,
  moveSidebarFavorite,
  subscribeSidebarFavorites,
  syncSidebarFavorites,
} from '../../lib/sidebarFavorites'
import { favoriteSessionId } from '../../lib/sidebarPinnedChats'
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
  scopeChipForPath,
  onOpenPath,
  onOpenKey,
}: {
  userId: string
  teamId: string
  teamView: boolean
  sections: Section[]
  currentHref: string | null
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
  // rule keep their control so they can still be removed. Agents are not
  // pinned: a Bot already stays in Bots, and a Task is one-off.
  const canFavorite = useCallback(
    (item: Item) =>
      teamView &&
      item.enabled &&
      !item.project &&
      (Boolean(item.bot || item.channel) ||
        favoriteSessionId({ key: item.key, href: item.href }) === null) &&
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

  const placeBotPin = useCallback(
    (item: Item, before: Item | null) => {
      const entry = favoriteMatch(item) ?? favoriteEntryForItem(item)

      if (!favoriteMatch(item)) addSidebarFavorite(userId, teamId, entry)
      const target = before ? favoriteMatch(before) : undefined

      moveSidebarFavorite(
        userId,
        teamId,
        favoriteIdentity(entry),
        target ? favoriteIdentity(target) : null,
      )
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
      // "Monitors" alone doesn't say which BetterStack instance it belongs to,
      // and two instances would produce two identical rows. Qualify with the
      // scope, and take its logo as the row icon.
      const chip = scopeChipForPath?.(href) ?? null
      const liveLabel = live?.label ?? entry.label
      const label = chip ? `${chip.label} · ${liveLabel}` : liveLabel

      return {
        key: identity,
        href,
        label,
        icon:
          chip || live?.iconNode ? undefined : (live?.icon ?? favoriteFallbackIcon(identity, href)),
        iconNode: chip?.icon ?? live?.iconNode,
        enabled: true,
        active: currentHref != null && currentHref === href,
        onActivate: onOpenPath && ((newTab) => onOpenPath(href, label, newTab)),
      }
    }
    const key = entry.key && renamedTeamNavKey(entry.key)
    const live = key ? liveItemsByKey.get(key) : undefined
    // A favorite opens its page in its own tab rather than replacing whatever
    // the user is looking at, matching how href favorites already behave.
    const label = live?.label ?? entry.label
    const onActivate =
      onOpenKey && key ? (newTab: boolean) => onOpenKey(key, label, newTab) : undefined

    return live
      ? { ...live, onActivate }
      : {
          onActivate,
          key: identity,
          label: entry.label,
          icon: favoriteFallbackIcon(identity),
          enabled: true,
        }
  }
  // Agents are not pinned: an old agent pin stays stored but is not listed.
  const favoriteItems = favorites
    .filter((entry) => favoriteSessionId(entry) === null)
    .map(resolveFavorite)

  return {
    botPins: {
      order: favorites.flatMap((entry) => {
        const id = favoriteSessionId(entry)

        return id ? [`agent-session:${id}`] : []
      }),
      place: placeBotPin,
    },
    favoriteMatch,
    canFavorite,
    toggleFavorite,
    favoriteItems,
  }
}
