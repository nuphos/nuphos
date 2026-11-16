export const CONTEXT_TOO_LONG_MESSAGE =
  'This conversation is too long for the model. Start a new Task, or switch to a model with a larger context.'

/** How each provider words a prompt over its model's context, through any adapter. */
const CONTEXT_TOO_LONG =
  /context_length_exceeded|exceeds? the (?:model(?:['’]s)? )?context (?:limit|length|window)|maximum context length|prompt is too long|out of room in the model['’]s context window/iu

/** The sentence for a prompt over the model's context, or undefined. The provider's text stays in the logs. */
export function contextTooLongMessage(error: unknown): string | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if (CONTEXT_TOO_LONG.test(cause.message)) return CONTEXT_TOO_LONG_MESSAGE

  return undefined
}
