import { NewChatButton } from './NewChatButton'

import type { ReactNode } from 'react'

/** The "+" beside Chats; it opens what it created. */
export function chatSectionActions(
  teamId: string,
  onSelect: (key: string) => void,
): Record<string, ReactNode> {
  return {
    Channels: (
      <NewChatButton
        teamId={teamId}
        onCreated={(sessionId) => onSelect(`agent-session:${sessionId}`)}
      />
    ),
  }
}
