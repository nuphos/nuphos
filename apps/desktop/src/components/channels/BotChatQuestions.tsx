import { ArrowUpRight } from 'lucide-react'

import { api } from '../../api'
import { t } from '../../i18n'
import { DecisionToolPart } from '../agent/panel/ConnectCard'
import { ConnectCardContext } from '../agent/panel/connectCardContext'

import { botChatQuestion } from './botChatQuestion'

import type { SessionInputRequest } from '../agent/summary/sessionInputRequests'

/** One open question in a Bot's chat, answerable where the card itself can send the answer. */
export function BotChatQuestion({
  request,
  teamId,
  onOpenSession,
  onAnswer,
}: {
  request: SessionInputRequest
  teamId: string
  /** Absent for the Bot's own questions, which need no "From" line. */
  onOpenSession?: (sessionId: string) => void
  onAnswer: (text: string, replyTo: string) => void
}) {
  const { part, questions, answerable, replyTo } = botChatQuestion(request.inputRequest)

  return (
    <div className="flex flex-col gap-1.5">
      {onOpenSession && (
        <button
          type="button"
          onClick={() => onOpenSession(request.sessionId)}
          className="flex items-center gap-1 self-start text-[12px] text-tertiary hover:text-main"
        >
          {t('From {name}', { name: request.title || t('Untitled agent') })}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </button>
      )}
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
