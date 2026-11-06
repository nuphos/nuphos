import { t } from '../../../i18n'
import { useAgentAvatarPick } from '../../../lib/agentAvatarChoices'
import { AGENT_PROVIDER } from '../../../types/runtime'

import type { AgentProvider } from '../../../types/runtime'

/**
 * Who the composer writes to: a Bot by its name, a Task by its agent. Undefined
 * leaves the composer's own fallback.
 */
export function useComposerPlaceholder(
  tab: { sessionId?: string; title: string; agentRuntime?: AgentProvider } | null | undefined,
) {
  const bot = Boolean(useAgentAvatarPick(tab?.sessionId ?? ''))

  if (bot && tab?.title) return t('Message {name}', { name: tab.title })
  if (tab?.agentRuntime)
    return t('Message {name}', { name: AGENT_PROVIDER[tab.agentRuntime].label })

  return undefined
}
