import { useEffect } from 'react'

import { api } from '../../api'
import { readLocalStorage, writeLocalStorage } from '../../app/localStorage'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'

import {
  forgetSeen,
  freshAccess,
  noticeWords,
  seenBefore,
  teamsToSeed,
} from './computerAccessNotice'
import { useAgentDevices } from './useAgentDevices'

/** Often enough to hear of a new computer the same minute, rarely enough to cost nothing. */
const POLL_MS = 60_000

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

  useEffect(() => {
    if (!teamId || !viewerId || !list) return
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
    for (const notice of notices) {
      const { title, body } = noticeWords(notice)

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
          // Not shown: unsaved, so the next look announces it again.
          const left = forgetSeen(readLocalStorage(key), notice.device.deviceId)

          if (left) writeLocalStorage(key, JSON.stringify(left))
        })
    }
    // What was seen is written before anything is announced, so a later run never repeats it.
  }, [list, openComputers, teamId, teams, viewerId])
}
