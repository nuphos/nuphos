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

/**
 * The questions a card answers as a form, or null for one single-choice
 * question, which keeps its one-click options.
 */
export function formQuestions(card: DecisionFormInput): DecisionQuestion[] | null {
  if (card.questions?.length) return card.questions
  if (card.multiSelect && card.options.length > 0)
    return [{ question: card.question, options: card.options, multiSelect: true }]

  return null
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

/** One question's answer in words: its picked options, or what was typed in their place. */
export function answerText(picked: readonly string[], typed: string): string {
  return typed.trim() || picked.join(', ')
}

/** What a form answers: one question's picks or typed text, or one entry per question. */
export function formAnswer(
  questions: readonly DecisionQuestion[],
  picked: readonly (readonly string[])[],
  typed: readonly string[],
): DecisionAnswer {
  const one = (index: number) => {
    const words = typed[index]?.trim()

    return words ? { text: words } : { choices: [...(picked[index] ?? [])] }
  }

  return questions.length === 1 ? one(0) : { questions: questions.map((_, index) => one(index)) }
}

/** `list` with its `index` entry replaced. */
export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((entry, at) => (at === index ? value : entry))
}

/** A question's picked options after tapping `option`: one at a time, or any number. */
export function togglePick(picked: readonly string[], option: string, multiSelect: boolean) {
  if (picked.includes(option)) return picked.filter((o) => o !== option)

  return multiSelect ? [...picked, option] : [option]
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
