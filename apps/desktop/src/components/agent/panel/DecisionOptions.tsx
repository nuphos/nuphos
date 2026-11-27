import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { AnswerField } from './AnswerField'
import {
  clickOptions,
  formAnswer,
  initialStates,
  isAnswered,
  pickOption,
  replaceAt,
  toggleOther,
  unanswered,
} from './decisionFormModel'

import type { DecisionQuestion, QuestionState } from './decisionFormModel'
import type { DecisionAnswer } from '../../../api/agent-chat-types'
import type { ReactNode } from 'react'

type Props = {
  questions: readonly DecisionQuestion[]
  disabled: boolean
  /** It may be answered in words, with "Other…". */
  typeable: boolean
  /** Said in place of "Other…" when there is nothing to click. */
  hint?: ReactNode
  /** An option's shortcut, for a card answered by a click. */
  keyTitle?: (index: number) => string | undefined
  onSubmit: (answer: DecisionAnswer) => void
  /** A card answered by a click: its "Other…" field opened or closed. */
  onTyping?: (open: boolean) => void
  /** "Other…" may be dictated, as the Inbox, which has no composer, lets it be. */
  voiceTeamId?: string
  /** A card answered by a click: another field took the words' place, as Dismiss's reason. */
  closesWords?: boolean
  children?: ReactNode
}

/**
 * A question card's options, each option and "Other…" the same pill (`PILL`).
 * One question with one answer is answered by clicking an option, "Other…"
 * opening a field with its own Send, and `children` (Snooze, Dismiss) end the row.
 * A multi-select, or a card of several questions, is a form: each question picks
 * its options or "Other", whose field sits under them, and one footer under them
 * all holds `children` and the card's one Send, "Answer N more" until each is answered.
 */
export function DecisionOptions(props: Props) {
  const { questions } = props

  return clickOptions(questions) ? (
    <ClickRow {...props} question={questions[0]} />
  ) : (
    <Form {...props} />
  )
}

/** One question with one answer: a click on an option answers it, "Other…" opens a field with its own Send. */
function ClickRow({
  question: q,
  disabled,
  typeable,
  hint,
  keyTitle,
  onSubmit,
  onTyping,
  voiceTeamId,
  closesWords = false,
  children,
}: Props & { question: DecisionQuestion }) {
  const [state, setState] = useState<QuestionState>({ picked: [], other: false, words: '' })
  // Put away while another field takes the words' place, and back as it was after.
  const open = state.other && !closesWords
  const toggleField = (value: boolean) => {
    setState({ ...state, other: value })
    onTyping?.(value)
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <fieldset className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {q.options.map((option, at) => (
            <Button
              key={option}
              variant="secondary"
              size="sm"
              disabled={disabled}
              className={PILL}
              title={keyTitle?.(at)}
              onClick={() => onSubmit({ choices: [option] })}
            >
              {option}
            </Button>
          ))}
          {typeable ? (
            <Button
              variant="secondary"
              size="sm"
              className={clsx(PILL, open && '!bg-state-hover')}
              aria-expanded={open}
              onClick={() => toggleField(!open)}
            >
              {q.options.length === 0 ? t('Reply…') : t('Other…')}
            </Button>
          ) : (
            q.options.length === 0 && hint
          )}
          {children}
        </div>
        {open && typeable && (
          <div data-card-answer-field>
            <AnswerField
              text={state.words}
              onText={(words) => setState({ ...state, words })}
              onSend={(text) => onSubmit({ text })}
              onClose={() => toggleField(false)}
              voiceTeamId={voiceTeamId}
            />
          </div>
        )}
      </fieldset>
    </div>
  )
}

/** A multi-select, or several questions: picked, then sent with the footer's one Send. */
function Form({ questions, disabled, typeable, hint, onSubmit, voiceTeamId, children }: Props) {
  const [first] = useState(() => initialStates(questions, typeable))
  const [states, setStates] = useState(first)
  const update = (index: number, state: QuestionState) => setStates(replaceAt(states, index, state))
  const left = unanswered(states)
  const several = questions.length > 1
  // Return in a field sends the card once every question is answered, and does nothing before.
  const send = (next: readonly QuestionState[]) => {
    if (unanswered(next) === 0) onSubmit(formAnswer(next))
  }

  return (
    <div className="flex flex-col gap-5 pt-3">
      {questions.map((q, index) => {
        const state = states[index] ?? { picked: [], other: false, words: '' }
        const reply = q.options.length === 0
        const role = q.multiSelect ? 'checkbox' : 'radio'

        return (
          <fieldset key={index} className="flex flex-col gap-2">
            {several && (
              <legend className="mb-2.5 flex w-full items-start gap-2.5">
                <Marker number={index + 1} answered={isAnswered(state)} />
                <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-main">
                  {q.question}
                </span>
                {q.multiSelect && (
                  <span className="shrink-0 text-[13px] leading-5 text-tertiary">
                    {t('Choose any')}
                  </span>
                )}
              </legend>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {q.options.map((option) => (
                <Pick
                  key={option}
                  role={role}
                  on={state.picked.includes(option)}
                  disabled={disabled}
                  onClick={() => update(index, pickOption(state, option, q.multiSelect))}
                >
                  {option}
                </Pick>
              ))}
              {/* With nothing to pick, the question is its field alone. */}
              {typeable && !reply && (
                <Pick
                  role={role}
                  on={state.other}
                  disabled={disabled}
                  onClick={() => update(index, toggleOther(state))}
                >
                  {state.other ? t('Other') : t('Other…')}
                </Pick>
              )}
              {!typeable && reply && hint}
            </div>
            {state.other && typeable && (
              <div data-card-answer-field>
                <AnswerField
                  text={state.words}
                  onText={(words) => update(index, { ...state, words })}
                  onSend={(words) => send(replaceAt(states, index, { ...state, words }))}
                  onClose={() => !reply && update(index, toggleOther(state))}
                  action={null}
                  // A field shown from the start leaves the caret where it is.
                  autoFocus={states !== first}
                  voiceTeamId={voiceTeamId}
                />
              </div>
            )}
          </fieldset>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button
          size="sm"
          // Sunken with a hairline, in muted text, until it can send.
          className="ml-auto h-8 px-3 disabled:!shadow-[0_0_0_1px_rgb(var(--color-line-control))]"
          disabled={disabled || left > 0}
          onClick={() => onSubmit(formAnswer(states))}
        >
          {left > 0 ? t('Answer {n} more', { n: left }) : t('Send')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Every button of the row the same pill, as Paper's question card draws a choice. A long option
 * wraps: `!` because Button's `whitespace-nowrap` comes later in the stylesheet and would win.
 */
export const PILL =
  '!h-auto min-h-8 min-w-0 max-w-full gap-1.5 !whitespace-normal [overflow-wrap:anywhere] rounded-[9px] px-3 py-1.5 text-left text-[13px] font-normal'

/** An option of a form, or its "Other": a check once picked. */
function Pick({
  role,
  on,
  disabled,
  onClick,
  children,
}: {
  role: 'checkbox' | 'radio'
  on: boolean
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      role={role}
      aria-checked={on}
      className={PILL}
      onClick={onClick}
    >
      {on && <Check aria-hidden className="size-3.5 shrink-0" />}
      {children}
    </Button>
  )
}

/** A question's number in a ring, or a check on ink once it is answered. */
function Marker({ number, answered }: { number: number; answered: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'flex size-5 shrink-0 items-center justify-center rounded-full',
        answered
          ? 'bg-action-primary text-inverse'
          : 'border-[1.5px] border-action-primary/[0.28] text-[11px] font-semibold text-tertiary',
      )}
    >
      {answered ? <Check className="size-3" strokeWidth={3} /> : number}
    </span>
  )
}
