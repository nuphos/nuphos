import { useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { answerText, formAnswer, replaceAt, togglePick } from './decisionFormModel'

import type { DecisionQuestion } from './decisionFormModel'
import type { DecisionAnswer } from '../../../api/agent-chat-types'
import type { ReactNode } from 'react'

/**
 * A card's questions answered together: options toggled (one, or any number
 * with `multiSelect`), or the answer typed in their place, sent as one answer.
 * `children` end the row of its send button.
 */
export function DecisionForm({
  questions,
  disabled,
  onSubmit,
  children,
}: {
  questions: readonly DecisionQuestion[]
  disabled: boolean
  onSubmit: (answer: DecisionAnswer) => void
  children?: ReactNode
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ''))
  const answers = questions.map((_, index) => answerText(picked[index] ?? [], typed[index] ?? ''))
  const toggle = (index: number, option: string, multiSelect: boolean) =>
    setPicked(replaceAt(picked, index, togglePick(picked[index] ?? [], option, multiSelect)))

  return (
    <form
      className="flex flex-col gap-3 pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(formAnswer(questions, picked, typed))
      }}
    >
      {questions.map((q, index) => (
        <fieldset key={index} className="flex flex-col gap-1.5" disabled={disabled}>
          {questions.length > 1 && (
            <legend className="mb-1.5 text-[12.5px] font-medium text-main">{q.question}</legend>
          )}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={picked[index]?.includes(option) ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={picked[index]?.includes(option) ?? false}
                  className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
                  onClick={() => toggle(index, option, q.multiSelect)}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          <input
            type="text"
            aria-label={t('Your answer')}
            placeholder={q.options.length > 0 ? t('Or type your own answer') : t('Your answer')}
            value={typed[index] ?? ''}
            onChange={(event) => setTyped(replaceAt(typed, index, event.target.value))}
            className="min-w-0 rounded-md border border-line-control bg-surface px-2.5 py-1.5 text-[12.5px] text-main outline-none focus:border-line-focus"
          />
        </fieldset>
      ))}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={disabled || answers.some((answer) => !answer)}>
          {t('Send answer')}
        </Button>
        {children}
      </div>
    </form>
  )
}
