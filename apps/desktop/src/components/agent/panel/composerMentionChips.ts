import { renderMentionChip } from '../../../lib/atlasLinkMention'

import { sessionMentionUrl } from './composerMention'

import type { AgentCredentialOptions } from '../../../api/agent-credential-types'
import type { AgentConversation } from '../../../api/agent-types'
import type { TeamMember } from '../../../types'

export const MENTION_ATTR = 'data-mention-user-id'

export type MentionOption =
  | { kind: 'member'; member: TeamMember }
  | { kind: 'device'; device: AgentCredentialOptions['devices'][number] }
  | { kind: 'session'; session: AgentConversation }

/** A chip that sends as its `@Name` text; a teammate's also carries their id. */
function nameChip(name: string, userId?: string): HTMLElement {
  const chip = document.createElement('span')

  chip.contentEditable = 'false'
  if (userId) chip.setAttribute(MENTION_ATTR, userId)
  chip.className = 'rounded px-0.5 font-medium text-zViolet-accent bg-zViolet-accent/10'
  chip.textContent = `@${name}`

  return chip
}

export function optionKey(option: MentionOption): string {
  switch (option.kind) {
    case 'member':
      return option.member.id
    case 'device':
      return option.device.deviceId
    case 'session':
      return option.session.sessionId
  }
}

/** What a picked option leaves in the editor. */
/** In a channel an agent is named, as a person is, so it knows it was addressed. */
export function optionChip(option: MentionOption, teamId: string, channel = false): HTMLElement {
  switch (option.kind) {
    case 'member':
      return nameChip(option.member.name || option.member.email, option.member.id)
    case 'device':
      return nameChip(option.device.label)
    case 'session':
      return channel
        ? nameChip(option.session.title || option.session.sessionId)
        : renderMentionChip(sessionMentionUrl(teamId, option.session.sessionId))
  }
}
