import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from '../../api'
import { readLocalStorage, writeLocalStorage } from '../../app/localStorage'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useTeamMemberList } from '../../hooks/useTeamMemberList'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'

import { freshAccess, seenBefore, teamsToSeed } from './computerAccessNotice'
import { useAgentDevices } from './useAgentDevices'

import type { AccessNotice } from './computerAccessNotice'
import type { TeamMember } from '../../types/team'

/** Often enough to hear of a new computer the same minute, rarely enough to cost nothing. */
const POLL_MS = 60_000

function words(notice: AccessNotice, members: TeamMember[] | null) {
  const name =
    members?.find((member) => member.id === notice.device.ownerUserId)?.name ?? t('A teammate')
  const computer = notice.device.label

  return notice.access === 'manage'
    ? {
        title: t('{name} made you a manager of {computer}', { name, computer }),
        body: t('You can also add agents to it, rename it and choose who uses it.'),
      }
    : {
        title: t('{name} shared {computer} with you', { name, computer }),
        body: t('Your agents can run on it now. Pick it when you start a chat.'),
      }
}

/** What the viewer has in a team now, saved as already seen: only later changes are news. */
function seed(prefix: string, teamId: string, viewerId: string) {
  const key = `${prefix}.${teamId}`

  api
    .boxListDevices({ teamId })
    .then((list) => {
      // Opened in the meantime: that look is newer.
      if (readLocalStorage(key) === null)
        writeLocalStorage(key, JSON.stringify(freshAccess(null, list.devices, viewerId).next))
    })
    .catch(() => {
      // Nothing saved: when this team is first opened, what it shares is announced.
    })
}

/**
 * Tells the viewer when a teammate shares a computer with them, or makes them its manager:
 * nothing else does. What was seen is kept per person and team, so a computer shared while
 * the app was closed is announced the next time it opens, and one in a team opened later
 * when that team is first opened.
 */
export function useComputerAccessNotices(
  teamId: string | undefined,
  teams: readonly { id: string }[],
  openComputers: () => void,
) {
  const viewerId = useCurrentUser()?.id
  const { list } = useAgentDevices(() => POLL_MS, `access-notices:${teamId ?? ''}`, {
    enabled: Boolean(teamId && viewerId),
    teamId,
  })
  const members = useTeamMemberList(teamId)
  const queries = useQueryClient()

  useEffect(() => {
    // Wait for the members, so the notice names who shared it.
    if (!teamId || !viewerId || !list || !members) return
    const started = `nuphos.computerAccessSeen.${viewerId}`
    const key = `${started}.${teamId}`
    const firstLook = readLocalStorage(started) === null
    const { notices, next } = freshAccess(
      seenBefore(readLocalStorage(key), !firstLook),
      list.devices,
      viewerId,
    )

    writeLocalStorage(key, JSON.stringify(next))
    writeLocalStorage(started, '1')
    // The very first look: the other teams' lists are saved once too, never polled.
    if (firstLook) {
      const saved = (other: string) => readLocalStorage(`${started}.${other}`) !== null

      for (const other of teamsToSeed(
        teams.map((team) => team.id),
        teamId,
        saved,
      ))
        seed(started, other, viewerId)
    }
    // Made a manager: the Sign in buttons read which computers they manage, so read it again.
    if (notices.length)
      void queries.invalidateQueries({ queryKey: queryKeys.managedComputers(teamId) })
    for (const notice of notices) {
      const { title, body } = words(notice, members)

      void api
        .computerNotifyShared(
          `${viewerId}:${teamId}:${notice.device.deviceId}:${notice.access}`,
          teamId,
          title,
          body,
        )
        .then((shown) => {
          if (shown === 'in-app')
            toast.success(title, body, {
              action: { label: t('Open'), onClick: openComputers },
              timeoutMs: 12_000,
            })
        })
        .catch(() => {
          // Best effort: the computer is listed under Computers & runtimes either way.
        })
    }
    // What was seen is written before anything is announced, so a later run never repeats it.
  }, [list, members, openComputers, queries, teamId, teams, viewerId])
}
