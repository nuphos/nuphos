import { config } from '@/config'
import { logEvent } from '@/lib/observability'

const MAX_OUTPUT_TOKENS = config.agent.maxOutputTokens

export const MODEL_OUTPUT_BUDGET_TOKENS = Math.min(
  config.agent.modelOutputBudgetTokens,
  MAX_OUTPUT_TOKENS,
)

if (config.agent.modelOutputBudgetTokens > MAX_OUTPUT_TOKENS) {
  logEvent('warn', 'agent.config.output_budget_clamped', {
    model_id: config.agent.agentModelId,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    requested_model_output_budget_tokens: config.agent.modelOutputBudgetTokens,
    model_output_budget_tokens: MODEL_OUTPUT_BUDGET_TOKENS,
  })
}
// 5s, not 15s: production resume attaches were observed dying ~8–12s after the
// initial heartbeat (client_cancelled in Braintrust) — i.e. inside the gap
// before the second 15s heartbeat, consistent with an intermediary idle timeout
// of ~10s. A 5s cadence keeps every hop's idle window fed while a silent model
// stream produces no frames during a stall window (up to
// STALL_WINDOW_TOOL_EXECUTION_MS).
export const SSE_HEARTBEAT_INTERVAL_MS = 5_000
// Model-stream silence watchdog, tiered by what the LAST forwarded frame says
// the stream is doing. One flat 90s window meant a model that died mid-output
// kept the client blind (heartbeats only) for a minute and a half before the
// recoverable turn-paused frame went out (Braintrust).
//
// While the model is mid-output emitting free-form text deltas, healthy
// providers emit deltas sub-second, so 10s of silence is conclusive.
// NOTE: tool-call argument streaming and extended-thinking reasoning are
// deliberately NOT in this bucket — see STALL_WINDOW_TOOL_INPUT_MS and
// STALL_WINDOW_REASONING_MS.
export const STALL_WINDOW_GENERATING_MS = 10_000
// Extended thinking (summarized display). Silence here carries no liveness
// signal: the model burns raw thinking tokens that never reach the wire, and
// the summarizer flushes in bursts with routine 10s+ gaps between them — the
// 10s generating window aborted nearly every long thinking segment after the
// thinking rollout, and since reasoning is not replayed on resume the retry
// re-thought from scratch into the same abort (sessions looped 4+ pauses in 2
// minutes). So like tool-execution this is a wedged-stream backstop, not a
// stall detector; sized above the tool-execution backstop (150s) as the longest
// silence we tolerate before assuming the provider stream died mid-thinking.
export const STALL_WINDOW_REASONING_MS = 180_000
// The model has committed to a tool call (tool-input-start seen) and is now
// streaming its arguments. Bedrock routinely gaps multiple seconds here — the
// args can be a large multi-line bash script or file body, and under load the
// provider buffers the tool-use block before flushing. The 10s generating
// window was killing these mid-stream: the turn aborted on a half-emitted tool
// call, the client finalized it as "Interrupted before the tool finished" with
// the chip stuck on "Preparing command…", and auto-resume re-ran straight into
// the same stall (the cascade customers reported). Aborting here is uniquely
// harmful (a partial tool call can never complete on resume), so this gets the
// same generous time-to-first-token budget as awaiting the model.
export const STALL_WINDOW_TOOL_INPUT_MS = 60_000
// Awaiting the model's first token — stream start or the step boundary after
// a tool result. Time-to-first-token on a large cache-missed transcript can
// legitimately take tens of seconds, and a too-short window here livelocks:
// the silence pause makes the client resend the same transcript, which hits
// the same TTFT and times out again.
export const STALL_WINDOW_AWAITING_MODEL_MS = 60_000
// Backstop for a tool wedged with no frames flowing. Kept above the 120s
// sandbox exec timeout so the tool's own clean timeout always wins; an equal
// 90s window raced it and aborted the turn just short of the tool result.
export const STALL_WINDOW_TOOL_EXECUTION_MS = 150_000
// Wall-clock ceiling for a HEADLESS turn (Slack, Lark, Discord, MCP,
// triggers). There is no tool-call cap any more, and the remaining defenses all
// need something to go wrong: the stop gate needs the model to try to finish,
// runaway detection needs repeated failures, the watchdogs need silence. A loop
// that keeps making successful tool calls trips none of them — in-app that is
// what the Stop button is for, and headless has no Stop button. Generous enough
// that real work (a 23-minute cluster build-out is on record) finishes well
// inside it; this is a runaway fuse, not a budget.
export const HEADLESS_TURN_DEADLINE_MS = 45 * 60 * 1000
export const AGENT_RUN_TTL_MS = 60 * 60 * 1000
export const AGENT_STREAM_DONE_EVENT = 'atlas-stream-done'
// Emitted right before AGENT_STREAM_DONE_EVENT only when the model itself
// ended the turn (Bedrock end_turn → AI SDK finishReason 'stop'). Lets the
// client distinguish "the agent loop finished cleanly" from "the SSE writer
// finished" — the latter also fires on max-tokens, infra failures that bypass
// onFinish, and so on.
export const AGENT_TURN_COMPLETE_EVENT = 'atlas-turn-complete'
// First frame of a user turn, carrying the input that started it. Every device
// replays a run from frame 0, so a device that did not send the message learns
// it, and where the turn begins, from the run itself.
export const AGENT_TURN_START_EVENT = 'atlas-turn-start'
// Emitted when the turn ended without a clean `stop` finish — `stopOnLengthFinish`
// tripping on the output-token cap, a content filter, or the stall watchdog. It
// names the reason, so a client can say why the turn stopped instead of
// inferring it from the *absence* of a turn-complete frame.
//
// There is deliberately no tool-call step cap: the agent loop runs until the
// model itself stops calling tools. A turn that keeps going is bounded by the
// stop gate, the runaway wrap-up nudge, and the user's Stop button — not by a
// step budget that cuts the model off mid-work.
export const AGENT_TURN_PAUSED_EVENT = 'atlas-turn-paused'
// Synthetic user turn appended when a continuation transcript would otherwise
// end on an assistant message — extended-thinking models reject assistant
// prefill ("The conversation must end with a user message."). Provider-only
// request shaping, never typed by anyone: kept as a constant so the
// compaction path can recognize it and keep it out of durable summaries.
export const SYNTHETIC_CONTINUATION_PREFIX = '[automatic continuation — not typed by the user]'

export const SYNTHETIC_CONTINUATION_USER_TEXT = `${SYNTHETIC_CONTINUATION_PREFIX} The previous assistant turn was interrupted before completing. Continue from where it left off, taking the partial assistant content above into account. Do not repeat work that already completed.`

// Matches every server- or client-injected synthetic user turn (prefill
// guard, incomplete-tool resume nudge, stop-gate continuation) — all share
// the same prefix. These are request shaping, not real user turns, and must
// stay out of durable compaction summaries.
export class AgentStreamSilenceTimeout extends Error {
  details: Record<string, unknown>

  constructor(details: Record<string, unknown>) {
    super('The model stream produced no output before the silence watchdog')
    this.name = 'AgentStreamSilenceTimeout'
    this.details = details
  }
}

export function isAgentStreamSilenceTimeout(err: unknown): err is AgentStreamSilenceTimeout {
  return err instanceof AgentStreamSilenceTimeout
}
