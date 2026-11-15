/**
 * The notice the server wakes an agent with when a person answers its
 * question. Its text is written for the agent; this reads it back so people
 * are shown who answered what instead of the template.
 */
export type DecisionNotice = {
  requestId: string
  answeredBy: string
  question: string
  /** The asker's context, as the notice excerpts it. */
  body?: string
  options: string[]
  /** One entry per question answered. */
  answers: { question: string; answer: string }[]
}

/** The sender of the notice an answer wakes the asking agent with. */
export const DECISION_NOTICE = 'nuphos:decision'

const CONTEXT = /^Context (?:you|the asker) gave: /
const OPTIONS = 'Options: '
const ARROW = ' → '

function answeredBy(line: string): string | undefined {
  try {
    const name: unknown = JSON.parse(/^Answered by: ("(?:[^"\\]|\\.)*")/.exec(line)?.[1] ?? '')

    return typeof name === 'string' ? name : undefined
  } catch {
    return undefined
  }
}

/** The "- Which regions? → us, eu" lines; a typed answer's later lines stay with it. */
function answersOf(lines: string[], question: string) {
  const single = `- ${question}${ARROW}`
  const text = lines.join('\n')

  if (text.startsWith(single)) return [{ question, answer: text.slice(single.length) }]
  const answers: { question: string; answer: string }[] = []

  for (const line of lines) {
    const arrow = line.lastIndexOf(ARROW)

    if (line.startsWith('- ') && arrow > 0)
      answers.push({ question: line.slice(2, arrow), answer: line.slice(arrow + ARROW.length) })
    else if (answers.length) answers[answers.length - 1].answer += `\n${line}`
    else return []
  }

  return answers
}

export function parseDecisionNotice(text: string): DecisionNotice | null {
  const lines = text.split('\n')
  const requestId = /\(requestId ([^)\s]+)\)/.exec(lines[0])?.[1]
  const name = answeredBy(lines[1] ?? '')
  // The asker's context may hold an "Answer:" line of its own; the notice's comes last.
  const answerAt = lines.lastIndexOf('Answer:')

  if (!requestId || name === undefined || answerAt < 3 || !lines[2].startsWith('Question: '))
    return null
  const head = lines.slice(2, answerAt)
  const options = head.at(-1)?.startsWith(OPTIONS)
    ? (head.pop() ?? '').slice(OPTIONS.length).split(' | ')
    : []
  const contextAt = head.findIndex((line) => CONTEXT.test(line))
  const question = head
    .slice(0, contextAt < 0 ? head.length : contextAt)
    .join('\n')
    .slice('Question: '.length)
  // After the answers: the ids the question is about, then what the agent does next.
  const tail = lines.slice(answerAt + 1, -1)

  if (tail.at(-1)?.startsWith('About: ')) tail.pop()
  const answers = answersOf(tail, question)

  if (!answers.length) return null

  return {
    requestId,
    answeredBy: name,
    question,
    ...(contextAt >= 0 && { body: head.slice(contextAt).join('\n').replace(CONTEXT, '') }),
    options,
    answers,
  }
}

/**
 * Which of a question's options an answer picked: none when it was typed
 * instead. Several picks arrive joined by ", ".
 */
export function pickedOptions(options: readonly string[], answer: string): string[] {
  let rest = answer
  const picked = new Set<string>()

  // Longest first, so an option that contains another is not half taken.
  for (const option of [...options].sort((a, b) => b.length - a.length)) {
    if (!option || !rest.includes(option)) continue
    rest = rest.replace(option, '')
    picked.add(option)
  }

  return rest.replace(/, /g, '') === '' ? options.filter((option) => picked.has(option)) : []
}
