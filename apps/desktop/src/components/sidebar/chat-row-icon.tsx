import { RuntimeChatIcon } from './RuntimeChatIcon'

import type { Item } from './types'
import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

export function chatRowIcon(
  conversation: AgentConversation,
  runtimeState: RuntimeExecution | undefined,
): Pick<Item, 'icon' | 'iconNode'> {
  return { iconNode: <RuntimeChatIcon conversation={conversation} runtimeState={runtimeState} /> }
}
