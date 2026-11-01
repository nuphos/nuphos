import { t } from '../i18n/index.ts'

import type { AgentConversationActivitySource } from '../api'

export type ConversationActivityBadge = {
  kind: 'trigger' | 'slack'
  label: 'Trigger' | 'Slack'
  description: string
}

/** Badges are composable: a trigger-created conversation may also be linked to Slack. */
export function conversationActivityBadges(
  source?: AgentConversationActivitySource,
): ConversationActivityBadge[] {
  if (!source) return []

  const badges: ConversationActivityBadge[] = []

  if (source.origin === 'trigger') {
    badges.push({
      kind: 'trigger',
      label: 'Trigger',
      description: t('Started automatically by a trigger'),
    })
  }
  if (source.origin === 'slack' || source.linkedSlackThread) {
    badges.push({
      kind: 'slack',
      label: 'Slack',
      description:
        source.origin === 'slack' ? t('Started from Slack') : t('Linked to a Slack thread'),
    })
  }

  return badges
}

// Shown only to viewers whose composer is locked (non-owners, audit view) —
// the owner of a Slack-bound conversation can type here directly these days,
// so the Slack wording points at the thread as the place THIS viewer can reply.
export function conversationReadOnlyLabel(
  source: AgentConversationActivitySource | undefined,
  hasSlackThread: boolean,
): string {
  if (source?.origin === 'trigger' && hasSlackThread) {
    return t('Triggered investigation · reply in the Slack thread')
  }
  if (source?.origin === 'slack' && hasSlackThread) {
    return t('Slack conversation · reply in the Slack thread')
  }
  if (hasSlackThread) {
    return t('Linked Slack conversation · reply in the Slack thread')
  }
  if (source?.origin === 'trigger') {
    return t('Triggered investigation · view-only')
  }
  if (source?.origin === 'slack') {
    return t('Slack conversation · view-only')
  }

  return t('Shared agent · view-only')
}
