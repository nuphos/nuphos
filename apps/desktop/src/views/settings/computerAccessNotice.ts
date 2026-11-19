import { t } from '../../i18n/index.ts'

import type { AgentDevice } from '../../api/device-types.ts'

/** What a teammate's computer lets the viewer do, as last seen: deviceId → access. */
export type SeenAccess = Readonly<Record<string, 'use' | 'manage'>>

export type AccessNotice = { device: AgentDevice; access: 'use' | 'manage' }

/** Someone else's computer the viewer was given, and how far: owners never hear of their own. */
function grantedAccess(device: AgentDevice, viewerId: string): 'use' | 'manage' | null {
  if (!device.ownerUserId || device.ownerUserId === viewerId) return null

  return device.access === 'use' || device.access === 'manage' ? device.access : null
}

/**
 * The teammates' computers to announce, and what to remember for next time. With nothing
 * seen yet, the list is what the viewer already had: it is remembered, not announced.
 * Remembering only the current list means losing access and getting it back is news again,
 * and Use becoming Manage is news too.
 */
export function freshAccess(
  seen: SeenAccess | null,
  devices: readonly AgentDevice[],
  viewerId: string,
): { notices: AccessNotice[]; next: SeenAccess } {
  const next: Record<string, 'use' | 'manage'> = {}
  const notices: AccessNotice[] = []

  for (const device of devices) {
    const access = grantedAccess(device, viewerId)

    if (!access) continue
    next[device.deviceId] = access
    const before = seen?.[device.deviceId]

    if (seen && before !== access && !(before === 'manage' && access === 'use'))
      notices.push({ device, access })
  }

  return { notices, next }
}

/** A remembered list read back; anything unreadable counts as nothing seen yet. */
export function parseSeenAccess(raw: string | null): SeenAccess | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)

    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, 'use' | 'manage'] => entry[1] === 'use' || entry[1] === 'manage',
      ),
    )
  } catch {
    return null
  }
}

/**
 * What a team's list is compared with. Only the viewer's very first look anywhere is
 * remembered without a word; a team first opened after that has seen nothing yet, so what
 * it shares with them is news.
 */
export function seenBefore(raw: string | null, lookedBefore: boolean): SeenAccess | null {
  return parseSeenAccess(raw) ?? (lookedBefore ? {} : null)
}

/**
 * On the viewer's very first look, their other teams with nothing saved yet. Each gets a
 * starting list then, so what they already had there is not news when that team is opened.
 */
export function teamsToSeed(
  teamIds: readonly string[],
  currentTeamId: string,
  saved: (teamId: string) => boolean,
): string[] {
  return teamIds.filter((teamId) => teamId !== currentTeamId && !saved(teamId))
}

/** A notice is written once more, so a notice that could not be shown comes back next time. */
export function forgetSeen(raw: string | null, deviceId: string): SeenAccess | null {
  const seen = parseSeenAccess(raw)

  if (!seen) return null
  const { [deviceId]: _dropped, ...rest } = seen

  return rest
}

/**
 * What the notice says. The device list does not say who made the change (the owner or one of
 * its managers), so it names no one.
 */
export function noticeWords(notice: AccessNotice): { title: string; body: string } {
  const computer = notice.device.label

  return notice.access === 'manage'
    ? {
        title: t('You can now manage {computer}', { computer }),
        body: t('You can also add runtimes to it, rename it and choose who uses it.'),
      }
    : {
        title: t('{computer} is now shared with you', { computer }),
        body: t('Your Bots and tasks can run on it now. Pick it when you start a chat.'),
      }
}
