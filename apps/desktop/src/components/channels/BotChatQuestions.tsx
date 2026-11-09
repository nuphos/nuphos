import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { AgentPanel } from '../agent/AgentPanel'
import { DecisionToolPart } from '../agent/panel/ConnectCard'
import { ConnectCardContext } from '../agent/panel/connectCardContext'
import { inputRequestKey } from '../agent/summary/sessionInputRequests'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'

import { botChatQuestion } from './botChatQuestion'

import type { AgentPromptSeed } from '../agent/panel/model'
import type { SessionInputRequest } from '../agent/summary/sessionInputRequests'

type Answer = { draftId: string; replyTo: string; seed: AgentPromptSeed | null }

/**
 * The open questions of a Bot and of every agent under it, drawn in the Bot's
 * chat from the same records the Inbox reads, so answering here answers there.
 * An answer is the viewer's own turn in the conversation that asked, sent through
 * that conversation's panel, kept hidden as the Inbox keeps it; one per
 * conversation, so a second answer elsewhere never drops the first.
 */
export function BotChatQuestions({
  teamId,
  botId,
  onOpenSession,
}: {
  teamId: string
  botId: string
  onOpenSession: (sessionId: string) => void
}) {
  const { requests } = useSessionInputRequests(botId, teamId)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  // As in the Inbox, a question waits on its conversation's owner alone.
  const mine = requests.filter((request) => request.isOwner)

  return (
    <>
      {mine.length > 0 && (
        <div className="mx-auto mt-3 flex w-full max-w-[760px] flex-col gap-3 px-3">
          {mine.map((request) => (
            <BotChatQuestion
              key={inputRequestKey(request)}
              request={request}
              teamId={teamId}
              onOpenSession={onOpenSession}
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
          ))}
        </div>
      )}
      {Object.entries(answers).map(([sessionId, answer]) => (
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
      ))}
    </>
  )
}

function BotChatQuestion({
  request,
  teamId,
  onOpenSession,
  onAnswer,
}: {
  request: SessionInputRequest
  teamId: string
  onOpenSession: (sessionId: string) => void
  onAnswer: (text: string, replyTo: string) => void
}) {
  const { part, questions, answerable, replyTo } = botChatQuestion(request.inputRequest)
  const title = request.title || t('Untitled agent')

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => onOpenSession(request.sessionId)}
        className="flex items-center gap-1 self-start text-[12px] text-tertiary hover:text-main"
      >
        {t('From {name}', { name: title })}
        <ArrowUpRight aria-hidden className="size-3.5" />
      </button>
      <ConnectCardContext.Provider
        value={{
          send: (text, card) => onAnswer(text, replyTo(card)),
          // Written on the asking agent's runtime, as its own secure card writes it.
          saveSecret: async (name, value) =>
            (await api.agentSaveSecret(request.sessionId, name, value, teamId)).path,
          openQuestions: questions,
        }}
      >
        <DecisionToolPart
          part={part}
          now={0}
          teamId={teamId}
          canAct={answerable}
          canReply={answerable}
        />
      </ConnectCardContext.Provider>
    </div>
  )
}
