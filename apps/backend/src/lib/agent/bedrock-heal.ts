// Bedrock message-history healing (extracted from routes/agent.ts so the
// rewrite paths are unit-testable — the thinking incident showed these paths
// must be provable, not assumed).
//
// All functions are idempotent. healForBedrock mutates in place — callers can
// rely on the input array being healed even if they don't read the return
// value.
//
// Thinking-block invariants: none of these heals may reorder, drop, or split a
// `reasoning` part away from the head of its assistant message — the Anthropic
// API requires thinking blocks to lead the assistant message that carries them,
// and their signatures cover the block content. Cross-request HISTORY should
// not carry thinking at all: use stripReasoningParts on history built from the
// stored transcript (the model re-thinks; stale signatures over healed/mutated
// history are a rejection risk), and never on the live tool loop's step
// messages (the SDK must send the current turn's thinking blocks back with tool
// results).

import {
  dropDuplicateToolResults,
  dropOrphanToolResults,
  injectMissingToolResults,
  normalizeDuplicateToolCallIds,
  normalizeNullToolCallInputs,
} from './bedrock-heal-tool-results'

import type { HealableMessage } from './bedrock-heal-types'

export type { HealableMessage } from './bedrock-heal-types'
export type { CachePointSpec } from './bedrock-heal-cache'
export {
  applyTrailingCachePoint,
  appendStatusToLastUserMessage,
  BEDROCK_CACHE_POINT,
  normalizeMessagesForReplay,
  VERTEX_CACHE_POINT,
} from './bedrock-heal-cache'
export {
  dropDuplicateToolResults,
  dropOrphanToolResults,
  injectMissingToolResults,
  normalizeDuplicateToolCallIds,
  normalizeNullToolCallInputs,
} from './bedrock-heal-tool-results'

// Bedrock requires tool-use blocks to be the LAST thing in an assistant message; any text
// after them must live in a separate assistant message that comes after the tool-result message.
// Older renderer builds didn't split steps, so historical assistant messages can look like
// `[text, tool-call, tool-call, text]`. Split them into two assistant messages flanking the
// tool-result message so Bedrock accepts the history.
//
// Thinking note: reasoning parts lead the assistant message, so they always
// land in the HEAD half (which keeps the original message object) — a split
// never moves a thinking block off the front or into the tail message.
export function splitAssistantTextAfterToolCalls(messages: HealableMessage[]): HealableMessage[] {
  const out: HealableMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (!msg) continue
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
      out.push(msg)
      continue
    }
    const content = msg.content
    let lastToolIdx = -1

    for (let j = content.length - 1; j >= 0; j--) {
      // A tool-approval-request is part of the tool-call block (it must stay in
      // the same assistant message as its tool-call), not "text after a
      // tool-call" — so it counts as the trailing tool block and is never split
      // off into a separate message.
      if (content[j]?.type === 'tool-call' || content[j]?.type === 'tool-approval-request') {
        lastToolIdx = j
        break
      }
    }
    if (lastToolIdx === -1 || lastToolIdx === content.length - 1) {
      out.push(msg)
      continue
    }
    const head = content.slice(0, lastToolIdx + 1)
    const tail = content.slice(lastToolIdx + 1)

    out.push({ ...msg, content: head })
    if (messages[i + 1]?.role === 'tool') {
      out.push(messages[i + 1]!)
      i++
    }
    out.push({ role: 'assistant', content: tail })
  }

  return out
}

// Single entry point for everything Bedrock requires: dedup duplicate tool-call
// ids, inject missing tool-results, dedup duplicate tool-results, and split
// assistant messages where text follows tool-calls. Idempotent and mutates in
// place — callers can rely on the input array being healed even if they don't
// read the return value.
export function healForBedrock(messages: HealableMessage[]): HealableMessage[] {
  normalizeNullToolCallInputs(messages)
  normalizeDuplicateToolCallIds(messages)
  dropOrphanToolResults(messages)
  injectMissingToolResults(messages)
  dropDuplicateToolResults(messages)
  const split = splitAssistantTextAfterToolCalls(messages)

  if (split !== messages) {
    messages.length = 0
    for (const m of split) messages.push(m)
  }

  return messages
}

/**
 * Remove reasoning (thinking) parts from HISTORY messages.
 *
 * Thinking blocks carry cryptographic signatures over their content. History
 * we rebuild from the stored transcript is healed and re-sliced — sending it
 * back with stale thinking blocks risks signature-validation rejections, and
 * the Anthropic API neither needs nor uses prior-turn thinking (the model
 * re-thinks). The ONLY place thinking blocks must survive is the live tool
 * loop's step messages, which the AI SDK manages inside one streamText call —
 * never call this on those.
 *
 * Assistant messages that were reasoning-only become empty and are dropped
 * (Bedrock rejects empty content).
 */
export function stripReasoningParts(messages: HealableMessage[]): HealableMessage[] {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    const parts = msg.content
    const kept = parts.filter((p) => p?.type !== 'reasoning')

    if (kept.length === parts.length) continue
    if (kept.length === 0) {
      messages.splice(i, 1)
      i--
    } else {
      msg.content = kept
    }
  }

  return messages
}
