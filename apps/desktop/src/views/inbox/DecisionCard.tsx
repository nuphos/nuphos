import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MessageResponse } from '../../components/agent/MessageResponse'
import { AnswerField } from '../../components/agent/panel/AnswerField'
import {
  parseChoiceRequest,
  parseConnectRequest,
} from '../../components/agent/panel/connectCardModel'
import { CredentialSelectorButton } from '../../components/agent/panel/CredentialSelectorButton'
import { DecisionConversations } from '../../components/agent/panel/DecisionConversations'
import {
  clickOptions,
  formQuestions,
  ownBody,
} from '../../components/agent/panel/decisionFormModel'
import { DecisionOptions, PILL } from '../../components/agent/panel/DecisionOptions'
import { DecisionTitle } from '../../components/agent/panel/DecisionTitle'
import { botChatQuestion } from '../../components/channels/botChatQuestion'
import { BotChatQuestion } from '../../components/channels/BotChatQuestions'
import { useBotCredentials } from '../../components/channels/useBotCredentials'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { AnswerFailure } from './AnswerFailure'
import { KeyHint } from './KeyHint'
import { QuestionSource } from './QuestionRail'
import { SnoozeMenu } from './SnoozeMenu'
import { useAnswerFailure } from './useInbox'

import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'

/**
 * The Inbox's open question, read as a page: who asked and when, the question
 * as its headline and what the agent wrote to decide it from. A choice, of one
 * answer or several, is the card's own row of options, "Other…" to answer in
 * words, Snooze and Dismiss, all the same pill; the answer wakes the agent that
 * asked, and no message is sent. A secret or an integration keeps the card the
 * conversation draws: a secret sends only where
 * its value was saved, and an integration is selected in the asking
 * conversation's credentials, by whoever may change them. Snooze sets it aside
 * until a time; Dismiss closes it, with a reason for the agent if one is given.
 */
export function DecisionCard({
  teamId,
  conversation,
  bot,
  request,
  keys,
  onAnswer,
  onSnooze,
  onDismiss,
  onOpenSource,
}: {
  teamId: string
  conversation: AgentConversation
  /** The Bot it works under, when a Bot's task asked: the Inbox lists it there. */
  bot: AgentConversation | undefined
  request: AgentInputRequest
  /** Its keys are live: 1–9 choose, Esc closes "Other…". */
  keys: boolean
  onAnswer: (answer: DecisionAnswer) => void
  onSnooze: (until: Date) => void
  onDismiss: (reason: string) => void
  onOpenSource: (source: AgentConversation) => void
}) {
  const { sessionId } = conversation
  const source = request.aboutConversations?.length ? conversation : (bot ?? conversation)
  const canManage = Boolean(conversation.canManage) && !conversation.readOnly
  const connect = parseConnectRequest(request) !== null
  const credentials = useBotCredentials(teamId, connect && canManage ? sessionId : undefined)
  const { part, typed } = botChatQuestion(request)
  const page = pageChoice(part.input, typed)
  const failure = useAnswerFailure(request.id)
  const [other, setOther] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')

  useDigitKeys(keys && !other && !dismissing, page?.keyOptions, onAnswer)
  // Snooze and Dismiss, as two more of the options' buttons.
  const asides = (
    <>
      <SnoozeMenu className={PILL} onSnooze={onSnooze} />
      {!dismissing && (
        <Button
          variant="secondary"
          size="sm"
          className={PILL}
          onClick={() => {
            setOther(false)
            setDismissing(true)
          }}
        >
          <X aria-hidden className="size-3.5" />
          {t('Dismiss')}
        </Button>
      )}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <article className="mx-auto flex w-full max-w-[640px] flex-col px-6 pb-10 pt-12">
        <QuestionSource
          conversation={source}
          askedAt={request.askedAt}
          updatedAt={request.updatedAt}
          onOpen={() => onOpenSource(source)}
        />
        {page && Boolean(request.aboutConversations?.length) && (
          <div className="mt-2">
            <DecisionConversations conversations={request.aboutConversations} teamId={teamId} />
          </div>
        )}
        {page ? (
          <>
            <DecisionTitle as="h1" className="mt-3 text-[20px] font-semibold leading-7 text-main">
              {request.question}
            </DecisionTitle>
            {page.body && (
              <MessageResponse
                className="selectable mt-3 text-[13.5px] text-secondary"
                streaming={false}
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
                onTyping={(open) => {
                  setOther(open)
                  if (open) setDismissing(false)
                }}
                closesWords={dismissing}
                voiceTeamId={teamId}
              >
                {asides}
              </DecisionOptions>
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
            <div className="flex flex-wrap items-center gap-2">{asides}</div>
          </div>
        )}
        {dismissing && (
          <div className="mt-4">
            <AnswerField
              text={reason}
              onText={setReason}
              onSend={onDismiss}
              onClose={() => setDismissing(false)}
              label={t('Reason (optional)')}
              // The server takes a reason of up to 1,000 characters.
              maxLength={1_000}
              action={t('Dismiss')}
              optional
            />
          </div>
        )}
        <footer className="mt-4 flex items-center gap-3 text-[11.5px] text-tertiary">
          {other || dismissing ? (
            <>
              <KeyHint keys={['↵']} label={dismissing ? t('Dismiss') : t('Send')} />
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
  const clicked = clickOptions(questions)

  return {
    questions,
    body: ownBody(choice.body, choice.questions),
    keyOptions: clicked?.length ? clicked : undefined,
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
