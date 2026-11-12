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

/** One question's answer in words: its picked options, or what was typed in their place. */
export function answerText(picked: readonly string[], typed: string): string {
  return typed.trim() || picked.join(', ')
}

/**
 * The one message a form sends: a lone question's answer as is, or each
 * question followed by its answer.
 */
export function formReply(questions: readonly DecisionQuestion[], answers: readonly string[]) {
  if (questions.length === 1) return answers[0] ?? ''

  return questions.map((q, index) => `${q.question}\n${answers[index] ?? ''}`).join('\n\n')
}

/** Whether a reply is the one a form sent, so its card shows as answered. */
export function answersForm(questions: readonly DecisionQuestion[], text: string): boolean {
  const first = questions.at(0)

  if (!first) return false
  if (questions.length > 1) return text.startsWith(`${first.question}\n`)

  return text.split(', ').every((part) => first.options.includes(part))
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
