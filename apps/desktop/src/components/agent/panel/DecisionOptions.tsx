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
 * A question card's options, one design for every question: a row of buttons,
 * "Other…" to answer in words, and `children` (Skip) at the end. One question
 * with one answer is answered by clicking an option, the first one filled. A
 * multi-select, or a card of several questions, picks its options (checkboxes,
 * or radios for a one-answer question among several) and sends them with Send.
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
  children?: ReactNode
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  // What was typed is kept while a field is closed; only an open field answers.
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ''))
  const [open, setOpen] = useState<boolean[]>(() => questions.map(() => false))
  const instant = clickOptions(questions) !== undefined
  const words = typed.map((text, index) => (open[index] ? text : ''))
  const complete = questions.every(
    (_, index) => (picked[index]?.length ?? 0) > 0 || Boolean(words[index]?.trim()),
  )
  const toggleField = (index: number, value: boolean) => {
    setOpen(replaceAt(open, index, value))
    onTyping?.(value)
  }
  const last = questions.length - 1

  return (
    <div className="flex flex-col gap-3 pt-3">
      {questions.map((q, index) => (
        <fieldset key={index} className="flex flex-col gap-2.5">
          {questions.length > 1 && (
            <legend className="mb-2 text-[12.5px] font-medium text-main">{q.question}</legend>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {q.options.map((option, at) => {
              const on = picked[index]?.includes(option) ?? false
              const filled = instant ? at === 0 : on

              return (
                <Button
                  key={option}
                  variant={filled ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={disabled}
                  role={instant ? undefined : pickRole(q)}
                  aria-checked={instant ? undefined : on}
                  className="h-auto min-h-8 gap-1.5 whitespace-normal rounded-[9px] px-[13px] py-1.5 text-left"
                  title={instant ? keyTitle?.(at) : undefined}
                  onClick={() => {
                    if (instant) onSubmit({ choices: [option] })
                    else
                      setPicked(
                        replaceAt(
                          picked,
                          index,
                          togglePick(picked[index] ?? [], option, q.multiSelect),
                        ),
                      )
                  }}
                >
                  {!instant && (
                    <Check aria-hidden className={clsx('size-3.5 shrink-0', !on && 'hidden')} />
                  )}
                  {option}
                </Button>
              )
            })}
            {typeable ? (
              <Button
                variant="ghost"
                size="sm"
                className={clsx('px-3', open[index] && '!bg-state-hover !text-main')}
                aria-expanded={open[index] ?? false}
                onClick={() => toggleField(index, !open[index])}
              >
                {q.options.length > 0 ? t('Other…') : t('Reply…')}
              </Button>
            ) : (
              q.options.length === 0 && hint
            )}
            {!instant && index === last && (
              <Button
                size="sm"
                className="h-8 px-3"
                disabled={disabled || !complete}
                onClick={() => onSubmit(formAnswer(questions, picked, words))}
              >
                {t('Send')}
              </Button>
            )}
            {index === last && children}
          </div>
          {open[index] && typeable && (
            <div data-card-answer-field>
              <AnswerField
                text={typed[index] ?? ''}
                onText={(text) => setTyped(replaceAt(typed, index, text))}
                onSend={() => complete && onSubmit(formAnswer(questions, picked, words))}
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

/** How a question's options are picked when Send answers them. */
function pickRole(question: DecisionQuestion) {
  return question.multiSelect ? 'checkbox' : 'radio'
}
