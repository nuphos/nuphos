import { ArrowUpRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { MessageResponse } from '../../components/agent/MessageResponse'
import {
  parseChoiceRequest,
  parseConnectRequest,
} from '../../components/agent/panel/connectCardModel'
import { CredentialSelectorButton } from '../../components/agent/panel/CredentialSelectorButton'
import { botChatQuestion } from '../../components/channels/botChatQuestion'
import { BotChatQuestion } from '../../components/channels/BotChatQuestions'
import { useBotCredentials } from '../../components/channels/useBotCredentials'
import { chatTime } from '../../components/sidebar/chat-preview'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { AnswerFailure } from './AnswerFailure'
import { QuestionSourceIcon } from './QuestionRail'
import { useAnswerFailure } from './useInbox'

import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'
import type { ReactNode } from 'react'

/**
 * The Inbox's open question, read as a page: who asked and when, the question
 * as its headline and what the agent wrote to decide it from. A choice is a row
 * of buttons, or "Other…" to answer in words; the answer wakes the agent that
 * asked, and no message is sent. Several questions at once, a secret or an
 * integration keep the card the conversation draws: a secret sends only where
 * its value was saved, and an integration is selected in the asking
 * conversation's credentials, by whoever may change them.
 */
export function DecisionCard({
  teamId,
  conversation,
  request,
  keys,
  onAnswer,
  onSkip,
  onOpenConversation,
}: {
  teamId: string
  conversation: AgentConversation
  request: AgentInputRequest
  /** Its keys are live: 1–9 choose, Esc closes "Other…". */
  keys: boolean
  onAnswer: (answer: DecisionAnswer) => void
  onSkip: (() => void) | undefined
  onOpenConversation: () => void
}) {
  const { sessionId } = conversation
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <article className="mx-auto flex w-full max-w-[640px] flex-col px-6 pb-10 pt-12">
        <header className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-tertiary">
          <QuestionSourceIcon conversation={conversation} />
          <button
            type="button"
            onClick={onOpenConversation}
            className="flex min-w-0 items-center gap-1 font-medium text-secondary hover:text-main"
          >
            <span className="truncate">{conversation.title || t('Untitled task')}</span>
            <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
          </button>
          <span aria-hidden>·</span>
          <time dateTime={request.askedAt} className="shrink-0">
            {chatTime(request.askedAt)}
          </time>
        </header>
        {plain ? (
          <>
            <h1 className="selectable mt-3 text-[20px] font-semibold leading-7 text-main">
              {request.question}
            </h1>
            {choice.body && (
              <MessageResponse
                className="selectable mt-3 text-[13.5px] text-secondary"
                streaming={false}
              >
                {choice.body}
              </MessageResponse>
            )}
            <ChoiceRow
              requestId={request.id}
              options={choice.options}
              typed={typed}
              keys={keys}
              other={other}
              onOther={setOther}
              onAnswer={onAnswer}
            />
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
              {plain && choice.options.length > 0 && (
                <KeyHint
                  keys={choice.options.slice(0, 2).map((_, index) => String(index + 1))}
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
 * The options as a row of buttons, the first the likely answer, and "Other…"
 * last, which opens a field to answer in words.
 */
function ChoiceRow({
  requestId,
  options,
  typed,
  keys,
  other,
  onOther,
  onAnswer,
}: {
  requestId: string
  options: string[]
  /** It may be answered in words. */
  typed: boolean
  keys: boolean
  other: boolean
  onOther: (open: boolean) => void
  onAnswer: (answer: DecisionAnswer) => void
}) {
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const failure = useAnswerFailure(requestId)
  const send = () => {
    if (text.trim()) onAnswer({ text: text.trim() })
  }

  useEffect(() => {
    if (other) field.current?.focus()
  }, [other])

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
            className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
            onClick={() => onAnswer({ choices: [option] })}
          >
            {option}
          </Button>
        ))}
        {typed && (
          <Button
            variant={other ? 'secondary' : 'ghost'}
            size="sm"
            aria-expanded={other}
            onClick={() => onOther(!other)}
          >
            {options.length > 0 ? t('Other…') : t('Reply…')}
          </Button>
        )}
      </div>
      {other && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          <input
            ref={field}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              onOther(false)
            }}
            aria-label={t('Your answer')}
            className="h-9 min-w-0 flex-1 rounded-lg bg-surface-raised px-3 text-[13px] text-main shadow-[0_0_0_1px_rgb(var(--color-line-control))] outline-none placeholder:text-tertiary focus:shadow-[0_0_0_1px_rgb(var(--color-line-focus))]"
          />
          <Button type="submit" size="md" disabled={!text.trim()}>
            {t('Send')}
            <kbd className="rounded bg-white/15 px-1 text-[11px] font-normal">↵</kbd>
          </Button>
        </form>
      )}
      {failure && <AnswerFailure message={failure} />}
    </div>
  )
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
