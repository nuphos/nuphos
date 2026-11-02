import { useEffect, useState } from 'react'

import { api } from '../api'

import type { TeamMember } from '../types'

export const ALL_ALLOW_LIST = ['*']

export function normalizeAllowList(list: string[] | undefined): string[] {
  if (!list) return []
  if (list.includes('*')) return [...ALL_ALLOW_LIST]

  return Array.from(new Set(list.filter(Boolean)))
}

export function allowListIsAll(list: string[]): boolean {
  return list.length === 1 && list[0] === '*'
}

export function memberDisplayName(member: TeamMember): string {
  return member.name || member.username || member.email
}

/** The team's members, or null while they load. */
export function useTeamMemberList(teamId: string): TeamMember[] | null {
  const [members, setMembers] = useState<TeamMember[] | null>(null)

  useEffect(() => {
    let alive = true

    api
      .atlasListTeamMembers(teamId)
      .then((items) => {
        if (alive) setMembers(items)
      })
      .catch(() => {
        if (alive) setMembers([])
      })

    return () => {
      alive = false
    }
  }, [teamId])

  return members
}

/** The team's members; none while they load. */
export function useTeamMembers(teamId: string): TeamMember[] {
  return useTeamMemberList(teamId) ?? []
}
