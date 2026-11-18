import { useEffect, useState } from 'react'

import { MessageResponse } from '../../components/agent/MessageResponse'
import {
  parseChoiceRequest,
  parseConnectRequest,
} from '../../components/agent/panel/connectCardModel'
import { CredentialSelectorButton } from '../../components/agent/panel/CredentialSelectorButton'
import { formQuestions, ownBody } from '../../components/agent/panel/decisionFormModel'
import { DecisionOptions } from '../../components/agent/panel/DecisionOptions'
import { DecisionTitle } from '../../components/agent/panel/DecisionTitle'
import { botChatQuestion } from '../../components/channels/botChatQuestion'
import { BotChatQuestion } from '../../components/channels/BotChatQuestions'
import { useBotCredentials } from '../../components/channels/useBotCredentials'
import { t } from '../../i18n'

import { AnswerFailure } from './AnswerFailure'
import { QuestionSource } from './QuestionRail'
import { useAnswerFailure } from './useInbox'

import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'
import type { ReactNode } from 'react'

/**
 * The Inbox's open question, read as a page: who asked and when, the question
 * as its headline and what the agent wrote to decide it from. A choice, of one
 * answer or several, is the card's own row of options, or "Other…" to answer in
 * words; the answer wakes the agent that asked, and no message is sent. A secret
 * or an integration keeps the card the conversation draws: a secret sends only where
 * its value was saved, and an integration is selected in the asking
 * conversation's credentials, by whoever may change them.
 */
export function DecisionCard({
  teamId,
  conversation,
  bot,
  request,
  keys,
  onAnswer,
  onSkip,
  onOpenSource,
  onOpenLink,
}: {
  teamId: string
  conversation: AgentConversation
  /** The Bot it works under, when a Bot's task asked: the Inbox lists it there. */
  bot: AgentConversation | undefined
  request: AgentInputRequest
  /** Its keys are live: 1–9 choose, Esc closes "Other…". */
  keys: boolean
  onAnswer: (answer: DecisionAnswer) => void
  onSkip: (() => void) | undefined
  onOpenSource: (source: AgentConversation) => void
  /** Opens a link in the question's text, as the conversation does. */
  onOpenLink: (href: string, beside: boolean) => boolean
}) {
  const { sessionId } = conversation
  const source = bot ?? conversation
  const canManage = Boolean(conversation.canManage) && !conversation.readOnly
  const connect = parseConnectRequest(request) !== null
  const credentials = useBotCredentials(teamId, connect && canManage ? sessionId : undefined)
  const { part, typed } = botChatQuestion(request)
  const page = pageChoice(part.input, typed)
  const failure = useAnswerFailure(request.id)
  const [other, setOther] = useState(false)

  useDigitKeys(keys && !other, page?.keyOptions, onAnswer)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <article className="mx-auto flex w-full max-w-[640px] flex-col px-6 pb-10 pt-12">
        <QuestionSource
          conversation={source}
          askedAt={request.askedAt}
          onOpen={() => onOpenSource(source)}
        />
        {page ? (
          <>
            <DecisionTitle as="h1" className="mt-3 text-[20px] font-semibold leading-7 text-main">
              {request.question}
            </DecisionTitle>
            {page.body && (
              <MessageResponse
                className="selectable mt-3 text-[13.5px] text-secondary"
                streaming={false}
                onLinkClick={onOpenLink}
              >
                {page.body}
              </MessageResponse>
            )}
            <div className="mt-2">
              <DecisionOptions
                key={request.id}
                questions={page.questions}
                disabled={false}
                typeable={typed}
                onSubmit={onAnswer}
                onTyping={setOther}
                voiceTeamId={teamId}
              />
            </div>
            {failure && <AnswerFailure message={failure} />}
          </>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <BotChatQuestion
              request={{ sessionId, title: conversation.title, inputRequest: request }}
              teamId={teamId}
              credentials={credentials}
              onAnswer={(answer) => onAnswer(answer)}
              onLinkClick={onOpenLink}
              fullBody
            />
            {/* The conversation's own picker, as its composer has it: a personal
                credential, or one of several, is chosen here. */}
            {credentials && (
              <div>
                <CredentialSelectorButton {...credentials} hero={false} personalIdentity />
              </div>
            )}
            {/* Only its owner selects a conversation's credentials; anyone else answers there. */}
            {connect && !canManage && (
              <span className="text-[12px] text-tertiary">
                {t('Only the owner of this conversation can connect this.')}
              </span>
            )}
          </div>
        )}
        <footer className="mt-4 flex items-center gap-3 text-[11.5px] text-tertiary">
          {other ? (
            <>
              <KeyHint keys={['↵']} label={t('Send')} />
              <KeyHint keys={['esc']} label={t('Close')} />
            </>
          ) : (
            <>
              <KeyHint keys={['↑', '↓']} label={t('Navigate')} />
              {page?.keyOptions && (
                <KeyHint
                  keys={page.keyOptions.slice(0, 2).map((_, index) => String(index + 1))}
                  label={t('Choose')}
                />
              )}
            </>
          )}
          {onSkip && (
            <button type="button" onClick={onSkip} className="ml-auto hover:text-main">
              {t('Skip')}
            </button>
          )}
        </footer>
      </article>
    </div>
  )
}

/**
 * A choice answered on the page, of one answer or several: its questions, the
 * body the agent wrote, and the options 1–9 choose when a click answers it.
 * Null for a secret or an integration, which keep their own card.
 */
function pageChoice(input: unknown, typed: boolean) {
  const choice = parseChoiceRequest(input)

  if (!choice) return null
  const questions = formQuestions(choice)

  if (!typed && !questions.some((q) => q.options.length > 0)) return null
  const instant = questions.length === 1 && !choice.multiSelect

  return {
    questions,
    body: ownBody(choice.body, choice.questions),
    keyOptions: instant && choice.options.length > 0 ? choice.options : undefined,
  }
}

/** 1–9 choose an option of a question answered by a click, unless a field has the caret. */
function useDigitKeys(
  enabled: boolean,
  options: string[] | undefined,
  onAnswer: (answer: DecisionAnswer) => void,
) {
  useEffect(() => {
    if (!enabled || !options) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))
        return
      const option = /^[1-9]$/.test(event.key) ? options[Number(event.key) - 1] : undefined

      if (option === undefined) return
      event.preventDefault()
      onAnswer({ choices: [option] })
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, options, onAnswer])
}

/** A key, or keys, and what pressing it does. */
function KeyHint({ keys, label }: { keys: string[]; label: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-4 rounded bg-surface-sunken px-1 text-center font-sans text-[10.5px] leading-4 text-secondary"
        >
          {key}
        </kbd>
      ))}
      <span className="ml-0.5">{label}</span>
    </span>
  )
}
