import { z } from 'zod'

// The fields of request_user_decision and its follow-ups.

/** A question is a card's one-line title in the Inbox and the chat; its context goes in `body`. */
export const QUESTION_MAX_CHARS = 120

/** The cards that explain themselves: the Connect card and the secure input card. */
const SELF_EXPLAINING = new Set(['credential', 'integration'])

export const questionField = z
  .string()
  .trim()
  .min(1)
  .max(
    QUESTION_MAX_CHARS,
    `Keep the question to one short line (at most ${String(QUESTION_MAX_CHARS)} characters) and put the details in \`body\`.`,
  )
  .describe(
    `One short question in the user's language, shown as the card's one-line title; at most ${String(QUESTION_MAX_CHARS)} characters. Details go in \`body\`.`,
  )
export const bodyField = z
  .string()
  .trim()
  .min(1)
  .max(8_000)
  .describe(
    'Markdown the user decides from: the relevant findings, what each choice does, and its risk.',
  )
export const optionsField = z
  .array(z.string().trim().min(1).max(300))
  .min(2)
  .max(5)
  .describe('Two to five concrete choices when the decision has a finite menu.')
export const multiSelectField = z
  .boolean()
  .describe('The user may pick any number of the options, not just one.')
const subQuestionField = z
  .object({
    question: questionField,
    options: optionsField.optional(),
    multiSelect: multiSelectField.optional(),
  })
  .strict()

export const questionsField = z
  .array(subQuestionField)
  .min(2)
  .max(4)
  .describe(
    'Two to four related questions answered together in one card, each with its own options. `question` is then the headline over them.',
  )
export const requestIdField = z
  .string()
  .min(1)
  .max(200)
  .describe('The requestId request_user_decision returned.')

/** Every question the user decides without a card of its own has a body to decide from. */
export function bodyRequired(
  input: { category: string; body?: string },
  ctx: z.RefinementCtx,
): void {
  if (!input.body && !SELF_EXPLAINING.has(input.category))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message:
        "Put what the user needs to decide in `body`; the question is only the card's one-line title.",
    })
}
