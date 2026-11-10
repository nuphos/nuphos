import { useState } from 'react'

import { AgentPanel } from '../agent/AgentPanel'
import { inputRequestKey } from '../agent/summary/sessionInputRequests'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'

import { BotChatQuestion } from './BotChatQuestions'
import { useBotCredentials } from './useBotCredentials'

import type { TimelineRow } from './ChannelMessages'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'
import type { AgentPromptSeed } from '../agent/panel/model'
import type { ReactNode } from 'react'

type Answer = { draftId: string; replyTo: string; seed: AgentPromptSeed | null }

/**
 * The open questions of a Bot and of every agent under it, as lines in the Bot's
 * chat at the time each was asked, drawn from the same records the Inbox reads,
 * so answering here answers there. An answer is the viewer's own turn in the
 * conversation that asked, sent through that conversation's panel, kept hidden
 * as the Inbox keeps it; one per conversation, so a second answer elsewhere
 * never drops the first. The Bot's own Connect cards select through the Bot's
 * credential picker, which its owner also gets in the chat's composer.
 */
export function useBotChatQuestions(
  teamId: string,
  botId: string | undefined,
  botOwned: boolean,
  onOpenSession: (sessionId: string) => void,
): { rows: TimelineRow[]; panels: ReactNode; credentials?: CredentialSelectorControl } {
  const botCredentials = useBotCredentials(teamId, botOwned ? botId : undefined)
  // The Task page's own reader: a chat opening draws what the Inbox lists now,
  // never a cached row's old questions, and never another Bot's.
  const { requests } = useSessionInputRequests(botId ?? null, teamId)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const rows = requests.map((request) => ({
    at: Date.parse(request.inputRequest.askedAt) || 0,
    key: `question-${inputRequestKey(request)}`,
    node: (
      <BotChatQuestion
        request={request}
        teamId={teamId}
        credentials={request.sessionId === botId ? botCredentials : undefined}
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

  return { rows, panels, credentials: botCredentials }
}
