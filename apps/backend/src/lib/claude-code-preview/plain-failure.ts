import { runtimeProductStateMessage } from './openab-acp-errors'

export const CONTEXT_TOO_LONG_MESSAGE =
  'This conversation is too long for the model. Start a new Task, or switch to a model with a larger context.'
export const MODEL_UNAVAILABLE_MESSAGE =
  "This model isn't available through the agent's current API endpoint or key. Pick another model, or check the endpoint's model list."
export const PROVIDER_UNREACHABLE_MESSAGE =
  "This computer couldn't reach the model provider's API. Check its network, proxy or VPN, then resend your message."
export const AGENT_CLI_UNSTARTABLE_MESSAGE =
  "The agent's CLI couldn't start on its computer, so its install may be broken. Reinstall it there, then resend your message."

/** How each provider words a prompt over its model's context, through any adapter. */
const CONTEXT_TOO_LONG =
  /context_length_exceeded|exceeds? the (?:model(?:['’]s)? )?context (?:limit|length|window)|maximum context length|prompt is too long|out of room in the model['’]s context window/iu
/** How providers and proxies word a model they do not serve: LiteLLM, Anthropic, OpenAI. */
const MODEL_UNAVAILABLE =
  /Invalid model name passed in model=|not_found_error[^}]*"model: |model_not_found|The model `[^`]+` does not exist/iu
/**
 * The agent's CLI could not connect to its provider's API: Claude Code's `Unable to connect to
 * API (<code>)` for a TLS failure, a reset or a timeout, which the computer's own network,
 * proxy or VPN causes.
 */
const PROVIDER_UNREACHABLE = /\bUnable to connect to API \((?:EPROTO|ECONNRESET|ETIMEDOUT)\)/u
/**
 * Node's refusal to start the agent's CLI: missing, not executable, not a program (npm's
 * placeholder claude.exe before its postinstall ran, which Windows reports as UNKNOWN), or a
 * Windows .cmd spawned without a shell. Node names the path when it has one, npm's `codex`
 * wrapper names the platform package it cannot find, and the Claude Agent SDK checks the file
 * before it spawns; another program an agent spawns is not its CLI.
 */
const AGENT_CLI_UNSTARTABLE =
  /\bspawn (?:[^\n]*[\\/](?:codex|claude)(?:\.exe)? )?(?:EINVAL|ENOENT|EACCES|UNKNOWN)\b|\bMissing optional dependency @openai\/codex-|\bClaude Code native binary not found\b/u

/** The sentence for each failure the user's own setup caused. */
export const USER_SETUP_MESSAGE = {
  context_too_long: CONTEXT_TOO_LONG_MESSAGE,
  model_unavailable: MODEL_UNAVAILABLE_MESSAGE,
  agent_cli_unstartable: AGENT_CLI_UNSTARTABLE_MESSAGE,
  provider_unreachable: PROVIDER_UNREACHABLE_MESSAGE,
}

const said = (error: unknown, pattern: RegExp) => {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if (pattern.test(cause.message)) return true

  return false
}

/**
 * A failure the user's own setup caused: a conversation too long for the model, a model the
 * endpoint does not serve, an agent CLI that cannot start, or a computer that cannot reach
 * the model API.
 */
export function userSetupFailure(error: unknown): keyof typeof USER_SETUP_MESSAGE | undefined {
  if (said(error, CONTEXT_TOO_LONG)) return 'context_too_long'
  if (said(error, MODEL_UNAVAILABLE)) return 'model_unavailable'
  if (said(error, AGENT_CLI_UNSTARTABLE)) return 'agent_cli_unstartable'
  if (said(error, PROVIDER_UNREACHABLE)) return 'provider_unreachable'

  return undefined
}

/**
 * The sentence for a failure only the user can resolve, whichever agent hit it, or undefined.
 * The provider's own text stays in the logs.
 */
export function plainTurnFailure(error: unknown): string | undefined {
  const setup = userSetupFailure(error)

  return setup ? USER_SETUP_MESSAGE[setup] : runtimeProductStateMessage(error)
}
