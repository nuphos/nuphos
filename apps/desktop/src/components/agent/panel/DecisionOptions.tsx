import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { AnswerField } from './AnswerField'
import { clickOptions, formAnswer, replaceAt, togglePick } from './decisionFormModel'

import type { DecisionQuestion } from './decisionFormModel'
import type { DecisionAnswer } from '../../../api/agent-chat-types'
import type { ReactNode } from 'react'

/**
 * A question card's options, one design for every question: each option, then
 * "Other…" to answer in words and `children` (Skip), one row of the same pill
 * (`PILL`). One question with one answer is answered by clicking an option. A
 * multi-select, or a card of several questions, picks its options (checkboxes,
 * or radios for a one-answer question among several; a check once picked) and
 * sends them with Send, the row's one filled button, at its end.
 */
export function DecisionOptions({
  questions,
  disabled,
  typeable,
  hint,
  keyTitle,
  onSubmit,
  onTyping,
  voiceTeamId,
  closesWords = false,
  children,
}: {
  questions: readonly DecisionQuestion[]
  disabled: boolean
  /** It may be answered in words, with "Other…". */
  typeable: boolean
  /** Said in place of "Other…" when there is nothing to click. */
  hint?: ReactNode
  /** An option's shortcut, for a card answered by a click. */
  keyTitle?: (index: number) => string | undefined
  onSubmit: (answer: DecisionAnswer) => void
  onTyping?: (open: boolean) => void
  /** "Other…" may be dictated, as the Inbox, which has no composer, lets it be. */
  voiceTeamId?: string
  /** Another field took the words' place, as Dismiss's reason: "Other…" closes. */
  closesWords?: boolean
  children?: ReactNode
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  // What was typed is kept while a field is closed; only an open field answers,
  // or one closed with Done, which keeps its words as the question's answer.
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ''))
  const [kept, setOpen] = useState<boolean[]>(() => questions.map(() => false))
  const [saved, setSaved] = useState<boolean[]>(() => questions.map(() => false))
  // Put away while another field takes the words' place, and back as it was after.
  const open = kept.map((was) => was && !closesWords)
  const instant = clickOptions(questions) !== undefined
  const words = typed.map((text, index) => (open[index] || saved[index] ? text : ''))
  const complete = questions.every(
    (_, index) => (picked[index]?.length ?? 0) > 0 || Boolean(words[index]?.trim()),
  )
  const toggleField = (index: number, value: boolean) => {
    setOpen(replaceAt(open, index, value))
    onTyping?.(value)
  }
  // A field's Send answers the card once every question is; until then it is
  // Done: its words become the question's answer and the field closes.
  const keepWords = (index: number) => {
    setSaved(replaceAt(saved, index, true))
    toggleField(index, false)
  }
  const last = questions.length - 1

  return (
    <div className="flex flex-col gap-3 pt-3">
      {questions.map((q, index) => (
        <fieldset key={index} className="flex flex-col gap-2">
          {questions.length > 1 && (
            <legend className="mb-2 text-[12.5px] font-medium text-main">{q.question}</legend>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {q.options.map((option, at) => {
              const on = picked[index]?.includes(option) ?? false

              return (
                <Button
                  key={option}
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  role={instant ? undefined : pickRole(q)}
                  aria-checked={instant ? undefined : on}
                  className={PILL}
                  title={instant ? keyTitle?.(at) : undefined}
                  onClick={() => {
                    if (instant) onSubmit({ choices: [option] })
                    else {
                      setPicked(
                        replaceAt(
                          picked,
                          index,
                          togglePick(picked[index] ?? [], option, q.multiSelect),
                        ),
                      )
                      // One answer: the option takes the place of words kept with Done.
                      if (!q.multiSelect) setSaved(replaceAt(saved, index, false))
                    }
                  }}
                >
                  {on && <Check aria-hidden className="size-3.5 shrink-0" />}
                  {option}
                </Button>
              )
            })}
            {typeable ? (
              <OtherPill
                open={open[index] ?? false}
                kept={saved[index] ? typed[index]?.trim() : undefined}
                reply={q.options.length === 0}
                onClick={() => toggleField(index, !open[index])}
              />
            ) : (
              q.options.length === 0 && hint
            )}
            {index === last && children}
            {!instant && index === last && (
              <Button
                size="sm"
                className="ml-auto h-8 px-3"
                disabled={disabled || !complete}
                onClick={() => onSubmit(formAnswer(questions, picked, words))}
              >
                {t('Send')}
              </Button>
            )}
          </div>
          {open[index] && typeable && (
            <div data-card-answer-field>
              <AnswerField
                text={typed[index] ?? ''}
                onText={(text) => setTyped(replaceAt(typed, index, text))}
                onSend={() =>
                  complete ? onSubmit(formAnswer(questions, picked, words)) : keepWords(index)
                }
                action={complete ? t('Send') : t('Done')}
                onClose={() => toggleField(index, false)}
                voiceTeamId={voiceTeamId}
              />
            </div>
          )}
        </fieldset>
      ))}
    </div>
  )
}

/**
 * Every button of the row the same pill, as Paper's question card draws a choice. A long option
 * wraps: `!` because Button's `whitespace-nowrap` comes later in the stylesheet and would win.
 */
export const PILL =
  'h-auto min-h-8 gap-1.5 !whitespace-normal rounded-[9px] px-3 py-1.5 text-left text-[13px] font-normal'

/**
 * "Other…" ("Reply…" with nothing to click) opens a question's field; once its
 * words are kept with Done, it shows them, picked as an option is, and a click
 * opens them to edit.
 */
function OtherPill({
  open,
  kept,
  reply,
  onClick,
}: {
  open: boolean
  kept: string | undefined
  reply: boolean
  onClick: () => void
}) {
  const label = reply ? t('Reply…') : t('Other…')
  const shown = !open && kept ? kept : undefined

  return (
    <Button
      variant="secondary"
      size="sm"
      className={clsx(PILL, open && '!bg-state-hover')}
      aria-expanded={open}
      title={kept}
      onClick={onClick}
    >
      {shown ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
      {shown ? <span className="max-w-[16rem] truncate">{shown}</span> : label}
    </Button>
  )
}

/** How a question's options are picked when Send answers them. */
function pickRole(question: DecisionQuestion) {
  return question.multiSelect ? 'checkbox' : 'radio'
}
