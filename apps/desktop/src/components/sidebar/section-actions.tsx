import { NewChannelButton } from '../channels/NewChannelButton'

import { NewBotButton } from './NewBotButton'

import type { ReactNode } from 'react'

/** The "+" beside Chats and Bots; each opens what it created. */
export function chatSectionActions(
  teamId: string,
  onSelect: (key: string) => void,
): Record<string, ReactNode> {
  const open = (sessionId: string) => onSelect(`agent-session:${sessionId}`)

  return {
    Channels: <NewChannelButton teamId={teamId} onCreated={open} />,
    Bots: <NewBotButton teamId={teamId} onCreated={open} />,
  }
}
