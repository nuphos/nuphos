import { useEffect, useState } from 'react'

import { api } from '../../api'
import { usePublishSessionArtifacts } from '../agent/artifacts/useSessionArtifacts'
import { renderCardToolPart } from '../agent/panel/cardToolParts'
import { fromPersistedMessages } from '../agent/panel/persistence'
import { useAgentSessions } from '../sidebar/agentSessions'

import type { TimelineRow } from './ChannelMessages'
import type { OpenLink } from '../agent/panel/LocalUrlChip'
import type { Message } from '../agent/panel/model'

/** The Bot turns read back for their cards: enough for a chat on screen. */
const TAIL = 40
const CARD_TOOLS = new Set(['render_artifact', 'render_chart'])
const NONE: Message[] = []

/**
 * The artifact and chart cards a Bot showed, as lines in its chat (#5272).
 * They live in the Bot's own turns, not in its posts, so the chat reads them
 * from there for anyone who may open the Bot's Task, and publishes them under
 * the chat, whose dock opens them the way a Task's does.
 */
export function useBotChatCards(
  teamId: string,
  channelId: string,
  bot: string | undefined,
  /** The viewer may read the Bot's turns. */
  canRead: boolean,
  onOpen: OpenLink | undefined,
): TimelineRow[] {
  const [loaded, setLoaded] = useState<{ bot: string; messages: Message[] }>()
  // Read again whenever the Bot's turns change, however short the turn was.
  const revision = useAgentSessions(teamId).data?.find(
    (session) => session.sessionId === bot,
  )?.transcriptUpdatedAt

  useEffect(() => {
    if (!bot || !canRead) return
    let live = true

    api
      .agentGetConversation(bot, teamId, { tail: TAIL, runtimeState: 'omit' })
      .then((detail) => {
        if (live) setLoaded({ bot, messages: fromPersistedMessages(detail.messages) })
      })
      .catch((error: unknown) => console.warn('[bot chat] could not read the Bot’s cards', error))

    return () => {
      live = false
    }
  }, [teamId, bot, canRead, revision])
  const messages = bot && canRead && loaded?.bot === bot ? loaded.messages : NONE

  usePublishSessionArtifacts(channelId, messages)
  const context = {
    teamId,
    sessionId: channelId,
    onOpen,
    now: 0,
    canAct: false,
    canReply: false,
    canApprove: false,
  }

  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== 'tool' || !CARD_TOOLS.has(part.toolName)) return []
      const key = `card-${part.toolCallId}`
      const card = renderCardToolPart(part, key, context)

      return card
        ? [
            {
              at: part.completedAt ?? message.createdAt ?? 0,
              key,
              // Inset past the faces on both sides, so the card lines up with the bubbles.
              node: <div className="px-[2.375rem]">{card}</div>,
            },
          ]
        : []
    }),
  )
}
