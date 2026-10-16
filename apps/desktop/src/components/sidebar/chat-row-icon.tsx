import { MessageSquare } from 'lucide-react'

import { AgentProviderIcon } from '../agent/panel/icons'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** The agent type only; running, error and background status live in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  return {
    iconNode: conversation.claudeCodeRuntimeAttached ? (
      <AgentProviderIcon provider={conversation.agentRuntime} className="h-3.5 w-3.5" />
    ) : (
      <MessageSquare className="h-3.5 w-3.5" />
    ),
  }
}
