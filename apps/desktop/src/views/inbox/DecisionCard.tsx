import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MessageResponse } from '../../components/agent/MessageResponse'
import { AnswerField } from '../../components/agent/panel/AnswerField'
import {
  parseChoiceRequest,
  parseConnectRequest,
} from '../../components/agent/panel/connectCardModel'
import { CredentialSelectorButton } from '../../components/agent/panel/CredentialSelectorButton'
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
import type { ReactNode } from 'react'

// An option button's look, which Snooze and Dismiss share.
const OPTION = 'h-auto min-h-8 whitespace-normal py-1.5 text-left'

/**
 * The Inbox's open question, read as a page: who asked and when, the question
 * as its headline and what the agent wrote to decide it from. A choice is a row
 * of buttons, or "Other…" to answer in words; the answer wakes the agent that
 * asked, and no message is sent. Several questions at once, a secret or an
 * integration keep the card the conversation draws: a secret sends only where
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
  onSnooze: (until: Date) => void
  onDismiss: (reason: string) => void
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
  const choice = parseChoiceRequest(part.input)
  // A plain choice is answered on the page; anything else on its own card.
  const plain =
    choice !== null &&
    !choice.multiSelect &&
    !choice.questions?.length &&
    (choice.options.length > 0 || typed)
  const [other, setOther] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')
  // Snooze and Dismiss, as two more of the options' buttons.
  const asides = (
    <>
      <SnoozeMenu className={OPTION} onSnooze={onSnooze} />
      {!dismissing && (
        <Button
          variant="secondary"
          size="sm"
          className={OPTION}
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
        {plain ? (
          <>
            <DecisionTitle as="h1" className="mt-3 text-[20px] font-semibold leading-7 text-main">
              {request.question}
            </DecisionTitle>
            {choice.body && (
              <MessageResponse
                className="selectable mt-3 text-[13.5px] text-secondary"
                streaming={false}
                onLinkClick={onOpenLink}
              >
                {choice.body}
              </MessageResponse>
            )}
            <ChoiceRow
              requestId={request.id}
              teamId={teamId}
              options={choice.options}
              typed={typed}
              keys={keys}
              other={other}
              onOther={(open) => {
                setOther(open)
                if (open) setDismissing(false)
              }}
              onAnswer={onAnswer}
            >
              {asides}
            </ChoiceRow>
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
              {plain && choice.options.length > 0 && (
                <KeyHint
                  keys={choice.options.slice(0, 2).map((_, index) => String(index + 1))}
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
 * The options as a row of buttons, the first the likely answer, and "Other…"
 * last, which opens a field to answer in words.
 */
function ChoiceRow({
  requestId,
  teamId,
  options,
  typed,
  keys,
  other,
  onOther,
  onAnswer,
  children,
}: {
  requestId: string
  teamId: string
  options: string[]
  /** It may be answered in words. */
  typed: boolean
  keys: boolean
  other: boolean
  onOther: (open: boolean) => void
  onAnswer: (answer: DecisionAnswer) => void
  /** Snooze and Dismiss, after the options and "Other…". */
  children: ReactNode
}) {
  const failure = useAnswerFailure(requestId)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!keys || other) return
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
  }, [keys, other, options, onAnswer])

  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option, index) => (
          <Button
            key={option}
            variant={index === 0 ? 'primary' : 'secondary'}
            size="sm"
            className={OPTION}
            onClick={() => onAnswer({ choices: [option] })}
          >
            {option}
          </Button>
        ))}
        {typed && (
          <Button
            variant="secondary"
            size="sm"
            className={other ? `${OPTION} !bg-state-hover` : OPTION}
            aria-expanded={other}
            onClick={() => onOther(!other)}
          >
            {options.length > 0 ? t('Other…') : t('Reply…')}
          </Button>
        )}
        {children}
      </div>
      {other && (
        <AnswerField
          text={draft}
          onText={setDraft}
          onSend={(text) => onAnswer({ text })}
          onClose={() => onOther(false)}
          voiceTeamId={teamId}
        />
      )}
      {failure && <AnswerFailure message={failure} />}
    </div>
  )
}
