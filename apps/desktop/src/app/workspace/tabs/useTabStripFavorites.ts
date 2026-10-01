import { useCallback, useEffect, useState } from 'react'

import {
  addSidebarFavorite,
  favoriteIdentity,
  readSidebarFavorites,
  removeSidebarFavorite,
  subscribeSidebarFavorites,
  syncSidebarFavorites,
} from '../../../lib/sidebarFavorites'

export function useTabStripFavorites(userId: string, favoriteTeamKey: string) {
  // A tab pins as an href favorite scoped to its own team, so the strip has to
  // watch every team currently open — hence a flat set of "teamId\0identity"
  // keys rather than the sidebar's single-team list. Reading straight from the
  // store on every change event keeps the star in sync with pins made from the
  // sidebar or another tab.
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const teamIds = favoriteTeamKey ? favoriteTeamKey.split('\0') : []
    const sync = () =>
      setFavoriteKeys(
        new Set(
          teamIds.flatMap((teamId) =>
            readSidebarFavorites(userId, teamId).map(
              (entry) => `${teamId}\0${favoriteIdentity(entry)}`,
            ),
          ),
        ),
      )

    sync()
    for (const teamId of teamIds) void syncSidebarFavorites(userId, teamId)
    const unsubscribes = teamIds.map((teamId) => subscribeSidebarFavorites(userId, teamId, sync))

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [favoriteTeamKey, userId])

  const isFavorited = useCallback(
    (teamId: string, appHref: string) =>
      favoriteKeys.has(`${teamId}\0${favoriteIdentity({ href: appHref })}`),
    [favoriteKeys],
  )

  const toggleFavorite = useCallback(
    (teamId: string, appHref: string, title: string) => {
      if (favoriteKeys.has(`${teamId}\0${favoriteIdentity({ href: appHref })}`)) {
        removeSidebarFavorite(userId, teamId, favoriteIdentity({ href: appHref }))

        return false
      }
      addSidebarFavorite(userId, teamId, { href: appHref, label: title })

      return true
    },
    [favoriteKeys, userId],
  )

  return { isFavorited, toggleFavorite }
}
