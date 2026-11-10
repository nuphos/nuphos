import { useState } from 'react'

import { useSwrCache } from '../../lib/swrCache'
import { useAnsweredOnDevice, useInboxListing } from '../../views/inbox/useInbox'
import { AgentPanel } from '../agent/AgentPanel'
import {
  botQuestions,
  inputRequestKey,
  relatedSessionIds,
} from '../agent/summary/sessionInputRequests'
import { useRefreshOnRuntimeChange } from '../agent/summary/useSessionInputRequests'
import { agentSessionsCacheKey } from '../sidebar/state'

import { BotChatQuestion } from './BotChatQuestions'

import type { TimelineRow } from './ChannelMessages'
import type { AgentConversation } from '../../api/agent-types'
import type { AgentPromptSeed } from '../agent/panel/model'
import type { ReactNode } from 'react'

type Answer = { draftId: string; replyTo: string; seed: AgentPromptSeed | null }

/**
 * The open questions of a Bot and of every agent under it, as lines in the Bot's
 * chat at the time each was asked, drawn from the same records the Inbox reads,
 * so answering here answers there. An answer is the viewer's own turn in the
 * conversation that asked, sent through that conversation's panel, kept hidden
 * as the Inbox keeps it; one per conversation, so a second answer elsewhere
 * never drops the first.
 */
export function useBotChatQuestions(
  teamId: string,
  botId: string | undefined,
  onOpenSession: (sessionId: string) => void,
): { rows: TimelineRow[]; panels: ReactNode } {
  // The Inbox's own listing, shared by every chat: a chat opening draws what is
  // listed now, never a cached row's old questions, and never another Bot's.
  const pending = useInboxListing(teamId)
  const known = useSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId))
  const answered = useAnsweredOnDevice()
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const requests = botId && pending ? botQuestions(botId, pending, known ?? [], answered) : []
  const under = botId ? relatedSessionIds(botId, [...(known ?? []), ...(pending ?? [])]) : []

  // A sub-agent under the Bot starting, stopping or waiting is when it asks.
  useRefreshOnRuntimeChange([...under].sort((a, b) => a.localeCompare(b)).join(','))
  const rows = requests.map((request) => ({
    at: Date.parse(request.inputRequest.askedAt) || 0,
    key: `question-${inputRequestKey(request)}`,
    node: (
      <BotChatQuestion
        request={request}
        teamId={teamId}
        // The Bot's own questions are this chat's; only an agent under it is named.
        onOpenSession={request.sessionId === botId ? undefined : onOpenSession}
        onAnswer={(text, replyTo) =>
          setAnswers((current) => ({
            ...current,
            [request.sessionId]: {
              draftId: `bot-chat:${inputRequestKey(request)}`,
              replyTo,
              seed: { text, nonce: Date.now(), autoSend: true, replace: true },
            },
          }))
        }
      />
    ),
  }))
  const panels = Object.entries(answers).map(([sessionId, answer]) => (
    <div key={sessionId} className="hidden">
      <AgentPanel
        variant="page"
        open
        focusComposerOnOpen={false}
        teamId={teamId}
        sessionId={sessionId}
        decisionReplyTo={answer.replyTo}
        composerDraftId={answer.draftId}
        pendingPrompt={answer.seed}
        onPromptConsumed={() =>
          setAnswers((current) => ({
            ...current,
            [sessionId]: { ...(current[sessionId] ?? answer), seed: null },
          }))
        }
      />
    </div>
  ))

  return { rows, panels }
}
