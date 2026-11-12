import { useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { answerText, formReply, replaceAt, togglePick } from './decisionForm'

import type { DecisionQuestion } from './decisionForm'

/**
 * A card's questions answered together: options toggled (one, or any number
 * with `multiSelect`), or the answer typed in their place, sent as one reply.
 */
export function DecisionForm({
  questions,
  disabled,
  onSubmit,
}: {
  questions: readonly DecisionQuestion[]
  disabled: boolean
  onSubmit: (text: string) => void
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ''))
  const answers = questions.map((_, index) => answerText(picked[index] ?? [], typed[index] ?? ''))
  const toggle = (index: number, option: string, multiSelect: boolean) =>
    setPicked(replaceAt(picked, index, togglePick(picked[index] ?? [], option, multiSelect)))

  return (
    <form
      className="flex flex-col gap-3 border-t border-line-control/60 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(formReply(questions, answers))
      }}
    >
      {questions.map((q, index) => (
        <fieldset key={q.question} className="flex flex-col gap-1.5" disabled={disabled}>
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
                  className="h-auto min-h-7 whitespace-normal px-2.5 py-1 text-left text-[12.5px]"
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
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={disabled || answers.some((answer) => !answer)}
      >
        {t('Send answer')}
      </Button>
    </form>
  )
}
