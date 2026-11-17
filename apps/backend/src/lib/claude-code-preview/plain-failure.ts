import { runtimeProductStateMessage } from './openab-acp-errors'

export const CONTEXT_TOO_LONG_MESSAGE =
  'This conversation is too long for the model. Start a new Task, or switch to a model with a larger context.'
export const MODEL_UNAVAILABLE_MESSAGE =
  "This model isn't available through the agent's current API endpoint or key. Pick another model, or check the endpoint's model list."

/** How each provider words a prompt over its model's context, through any adapter. */
const CONTEXT_TOO_LONG =
  /context_length_exceeded|exceeds? the (?:model(?:['’]s)? )?context (?:limit|length|window)|maximum context length|prompt is too long|out of room in the model['’]s context window/iu
/** How providers and proxies word a model they do not serve: LiteLLM, Anthropic, OpenAI. */
const MODEL_UNAVAILABLE =
  /Invalid model name passed in model=|not_found_error[^}]*"model: |model_not_found|The model `[^`]+` does not exist/iu

const said = (error: unknown, pattern: RegExp) => {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if (pattern.test(cause.message)) return true

  return false
}

/** A failure the user's own setup caused: a conversation too long for the model, or a model the endpoint does not serve. */
export function userSetupFailure(error: unknown) {
  if (said(error, CONTEXT_TOO_LONG)) return 'context_too_long' as const
  if (said(error, MODEL_UNAVAILABLE)) return 'model_unavailable' as const

  return undefined
}

/**
 * The sentence for a failure only the user can resolve, whichever agent hit it, or undefined.
 * The provider's own text stays in the logs.
 */
export function plainTurnFailure(error: unknown): string | undefined {
  const setup = userSetupFailure(error)

  if (setup === 'context_too_long') return CONTEXT_TOO_LONG_MESSAGE
  if (setup === 'model_unavailable') return MODEL_UNAVAILABLE_MESSAGE

  return runtimeProductStateMessage(error)
}
