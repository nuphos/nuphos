import { renderMentionChip } from '../../../lib/atlasLinkMention'

import { sessionMentionUrl } from './composerMention'

import type { AgentCredentialOptions } from '../../../api/agent-credential-types'
import type { AgentConversation, AgentMessageMention } from '../../../api/agent-types'
import type { TeamMember } from '../../../types'

export const MENTION_ATTR = 'data-mention-user-id'

/** What a send carries besides its text: the teammates its chips mention.
 *  It answers whether it took the draft: false is a refusal, and the composer
 *  keeps the text, attachments and folder chips for another try. */
export type ComposerSend = (
  text: string,
  filePaths: string[],
  mentions?: AgentMessageMention[],
  options?: { mode?: 'queue'; imageThumbs?: Readonly<Record<string, string>> },
) => boolean

/** The teammates the editor's chips mention, once each, named as the chip shows them. */
export function mentionedMembers(el: HTMLElement | null): AgentMessageMention[] {
  const chips = el?.querySelectorAll<HTMLElement>(`[${MENTION_ATTR}]`) ?? []
  const byId = new Map<string, string>()

  for (const chip of chips) {
    const id = chip.getAttribute(MENTION_ATTR)
    const name = chip.textContent?.replace(/^@/, '') ?? ''

    if (id && name && !byId.has(id)) byId.set(id, name)
  }

  return [...byId].map(([id, displayName]) => ({ id, displayName }))
}

export type MentionOption =
  | { kind: 'member'; member: TeamMember }
  | { kind: 'device'; device: AgentCredentialOptions['devices'][number] }
  | { kind: 'session'; session: AgentConversation }

/** A chip that sends as its `@Name` text; a teammate's also carries their id. */
function nameChip(name: string, userId?: string): HTMLElement {
  const chip = document.createElement('span')

  chip.contentEditable = 'false'
  if (userId) chip.setAttribute(MENTION_ATTR, userId)
  chip.className = 'rounded px-0.5 font-medium text-primary bg-state-selected'
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
/** A chat's own agent is named, as a person is, so it knows it was addressed;
 *  any other Bot or task is its link chip, so the agent can read or reach it. */
export function optionChip(
  option: MentionOption,
  teamId: string,
  chatAgentIds: string[] = [],
): HTMLElement {
  switch (option.kind) {
    case 'member':
      return nameChip(option.member.name || option.member.email, option.member.id)
    case 'device':
      return nameChip(option.device.label)
    case 'session':
      return chatAgentIds.includes(option.session.sessionId)
        ? nameChip(option.session.title || option.session.sessionId)
        : renderMentionChip(sessionMentionUrl(teamId, option.session.sessionId))
  }
}
