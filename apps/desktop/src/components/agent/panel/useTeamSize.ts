import { useEffect } from 'react'

import { useTeamMemberList } from '../../../hooks/useTeamMemberList'

import { knownTeamSize } from './homeCardCatalog'

/**
 * How many people are on the team: the last count seen on this machine until
 * the members load, and null before any is known. Team activity takes its
 * height from it, so the card keeps its place while they load. A failed load
 * keeps the last count.
 */
export function useTeamSize(teamId: string): number | null {
  const members = useTeamMemberList(teamId)
  const key = `home.teamSize.${teamId}`
  const loaded = members?.length ?? null

  useEffect(() => {
    if (loaded) localStorage.setItem(key, String(loaded))
  }, [key, loaded])

  return knownTeamSize(loaded, localStorage.getItem(key))
}
