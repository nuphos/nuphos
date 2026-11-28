import type { DecisionAnswer } from '../../../api/agent-chat-types.ts'

/** One question of a decision card: its choices, and whether several may be picked. */
export type DecisionQuestion = { question: string; options: string[]; multiSelect: boolean }

/** A card's own questions as the agent sent them. */
export type DecisionFormInput = {
  question: string
  options: string[]
  multiSelect?: boolean
  questions?: DecisionQuestion[]
}

/** The questions a card answers: its own `questions`, or the one it asks. */
export function formQuestions(card: DecisionFormInput): DecisionQuestion[] {
  if (card.questions?.length) return card.questions

  return [
    { question: card.question, options: card.options, multiSelect: card.multiSelect === true },
  ]
}

/**
 * The options a click answers, which keys choose: those of one question with one answer, read
 * from the question itself; none for a multi-select or several questions, which Send answers.
 */
export function clickOptions(questions: readonly DecisionQuestion[]): string[] | undefined {
  const [first] = questions

  return questions.length === 1 && first && !first.multiSelect ? first.options : undefined
}

/** Text on one line, as the written-out list has it. */
function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

/** The backend's `writtenQuestions`: the questions as markdown after a `---` separator, one line each. */
export function writtenQuestions(questions: readonly DecisionQuestion[]): string {
  const list = questions
    .map(({ question, options, multiSelect }, index) =>
      [
        `**${String(index + 1)}. ${oneLine(question)}**${multiSelect ? ' (any number)' : ''}`,
        ...options.map((option) => `- ${oneLine(option)}`),
      ].join('\n'),
    )
    .join('\n\n')

  return `\n\n---\n\n${list}`
}

/**
 * The body the agent wrote, without the list the backend writes out after it
 * for clients that do not render `questions`: dropped only when the body ends
 * with exactly that list, so a `---` of the agent's own always stays.
 */
export function ownBody(
  body: string | undefined,
  questions: readonly DecisionQuestion[] | undefined,
) {
  const written = questions?.length ? writtenQuestions(questions) : undefined

  return written && body?.endsWith(written)
    ? body.slice(0, -written.length).trim() || undefined
    : body
}

/** Where a form stands on one question: its picked options, or "Other" picked and the words under it. */
export type QuestionState = { picked: string[]; other: boolean; words: string }

/** A form's state before anything is picked: a question with nothing to pick shows its field, when it takes words. */
export function initialStates(
  questions: readonly DecisionQuestion[],
  typeable: boolean,
): QuestionState[] {
  return questions.map((q) => ({
    picked: [],
    other: typeable && q.options.length === 0,
    words: '',
  }))
}

/** A question is answered by its words when "Other" is picked, by its picks otherwise. */
export function isAnswered(state: QuestionState) {
  return state.other ? state.words.trim() !== '' : state.picked.length > 0
}

/** How many questions are still unanswered. */
export function unanswered(states: readonly QuestionState[]) {
  return states.filter((state) => !isAnswered(state)).length
}

/** What a form answers: words or picks, never both, alone for one question or one entry per question. */
export function formAnswer(states: readonly QuestionState[]): DecisionAnswer {
  const one = ({ picked, other, words }: QuestionState) =>
    other ? { text: words.trim() } : { choices: [...picked] }

  return states.length === 1 ? one(states[0]) : { questions: states.map(one) }
}

/** `list` with its `index` entry replaced. */
export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((entry, at) => (at === index ? value : entry))
}

/** A question after tapping `option`: one at a time, or any number; it unpicks "Other". */
export function pickOption(
  state: QuestionState,
  option: string,
  multiSelect: boolean,
): QuestionState {
  const { picked } = state

  if (picked.includes(option)) return { ...state, picked: picked.filter((o) => o !== option) }

  return { ...state, picked: multiSelect ? [...picked, option] : [option], other: false }
}

/** A question after tapping "Other": picking it unpicks the options; its words stay either way. */
export function toggleOther(state: QuestionState): QuestionState {
  return state.other ? { ...state, other: false } : { ...state, picked: [], other: true }
}

/** Parses a card's `questions` from a stored call or request, dropping malformed entries. */
export function parseDecisionQuestions(value: unknown): DecisionQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions = value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const { question, options, multiSelect } = entry as Record<string, unknown>

    if (typeof question !== 'string' || !question.trim()) return []

    return [
      {
        question: question.trim(),
        options: Array.isArray(options)
          ? options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
          : [],
        multiSelect: multiSelect === true,
      },
    ]
  })

  return questions.length > 0 ? questions : undefined
}
