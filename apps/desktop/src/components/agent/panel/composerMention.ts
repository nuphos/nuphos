import { ATLAS_WEB_BASE_URL } from '../../../lib/webBaseUrl.ts'

import type { AgentCredentialOptions } from '../../../api/agent-credential-types.ts'
import type { TeamMember } from '../../../types'

/** The `@query` being typed right before the caret, or null when there is none.
 *  An `@` only starts a mention at the start of a line or after whitespace, so
 *  an email address being typed never opens the picker. */
export function mentionQuery(textBeforeCaret: string): string | null {
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(textBeforeCaret)

  return match ? match[1] : null
}

/** Current members whose name, username or email contains the query. */
export function matchMembers(
  members: readonly TeamMember[],
  query: string,
  limit = 6,
): TeamMember[] {
  const needle = query.toLowerCase()

  return members
    .filter(
      (member) =>
        !member.removedAt &&
        [member.name, member.username, member.email].some((value) =>
          value?.toLowerCase().includes(needle),
        ),
    )
    .slice(0, limit)
}

/** The canonical link to a session — what a session mention sends, so the
 *  agent can read it with `read_conversation` and the chip resolves its title. */
export function sessionMentionUrl(teamId: string, sessionId: string): string {
  return `${ATLAS_WEB_BASE_URL}/teams/${encodeURIComponent(teamId)}/agent/${encodeURIComponent(sessionId)}`
}

/** The viewer's devices whose label contains the query. */
export function matchDevices(
  devices: AgentCredentialOptions['devices'],
  query: string,
  limit = 3,
): AgentCredentialOptions['devices'] {
  const needle = query.toLowerCase()

  return devices.filter((device) => device.label.toLowerCase().includes(needle)).slice(0, limit)
}

/** What tells a device apart in the @ menu: nothing when its label is unique,
 *  otherwise its status and the end of its id. */
export function deviceDetail(
  device: AgentCredentialOptions['devices'][number],
  devices: AgentCredentialOptions['devices'],
): string {
  if (devices.filter((other) => other.label === device.label).length < 2) return ''

  return `${device.available === false ? 'Offline' : 'Online'} · ${device.deviceId.slice(-4)}`
}
