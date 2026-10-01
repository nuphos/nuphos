import { randomUUID } from 'node:crypto'

import type { HealableMessage } from './bedrock-heal-types'

// If a stream hits maxOutputTokens while the model is still emitting tool
// input, AI SDK can persist a historical assistant tool-call with null input.
// Bedrock rejects that entire conversation before the model can recover.
export function normalizeNullToolCallInputs(messages: HealableMessage[]) {
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part?.type === 'tool-call' && part.input == null) {
        part.input = {}
      }
    }
  }
}

export function normalizeDuplicateToolCallIds(messages: HealableMessage[]) {
  const seen = new Set<string>()
  const remaps = new Map<string, string[]>()

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (msg.role === 'assistant' && part.type === 'tool-call' && part.toolCallId) {
        if (seen.has(part.toolCallId)) {
          const oldId = part.toolCallId
          const newId = `${String(oldId)}_${randomUUID().slice(0, 8)}`
          const queue = remaps.get(oldId) ?? []

          queue.push(newId)
          remaps.set(oldId, queue)
          part.toolCallId = newId
        } else {
          seen.add(part.toolCallId)
        }
        continue
      }
      if (msg.role === 'tool' && part.type === 'tool-result' && part.toolCallId) {
        const oldId = part.toolCallId
        const queue = remaps.get(oldId)

        if (queue?.length) {
          part.toolCallId = queue.shift()!
          if (queue.length === 0) remaps.delete(oldId)
        }
      }
    }
  }
}

// Drop tool-results whose tool-call is not present earlier in the list. History
// slicing can orphan tool results from their assistant tool-call — the
// compaction boundary is a persisted MESSAGE COUNT measured against a previous
// request's healed model-message list, and conversion is not stable across
// requests, so the boundary can land mid-pair (summary swallows the assistant
// tool-call, the orphan tool-result leads the remaining window). Bedrock
// rejects the entire conversation on the first unmatched toolResult block
// ("Expected toolResult blocks at messages.0.content…"), and because the
// boundary is persisted the rejection repeats deterministically on every retry
// (session f90d7eb9). The orphaned results' content is already covered by the
// summary, so dropping them is lossless.
export function dropOrphanToolResults(messages: HealableMessage[]) {
  const seenToolCallIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (!msg) continue
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === 'tool-call' && typeof part.toolCallId === 'string') {
          seenToolCallIds.add(part.toolCallId)
        }
      }
      continue
    }
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue
    const parts = msg.content
    const kept = parts.filter(
      (p) =>
        p?.type !== 'tool-result' ||
        (typeof p.toolCallId === 'string' && seenToolCallIds.has(p.toolCallId)),
    )

    if (kept.length === parts.length) continue
    if (kept.length === 0) {
      messages.splice(i, 1)
      i--
    } else {
      msg.content = kept
    }
  }
}

// Bedrock rejects assistant tool-calls that aren't immediately followed by tool-results.
// Aborted/interrupted streams can leave orphaned tool-calls in stored history; inject synthetic
// error results so the model can see the call was attempted and continue.
export function injectMissingToolResults(messages: HealableMessage[]) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    const toolCalls = msg.content.filter(
      (p) => p?.type === 'tool-call' && typeof p.toolCallId === 'string',
    )

    if (toolCalls.length === 0) continue

    // convertToModelMessages emits tool-approval-response with only an
    // approvalId — no toolCallId — so responses must be resolved back to their
    // tool-call through the request part riding in this assistant message
    // (session 81815b12: the id-less response made an answered approval look
    // unanswered, and the synthetic injected next to the real execution result
    // became "duplicate toolResult Ids" at Bedrock).
    const approvalIdToToolCallId = new Map<string, string>()

    for (const p of msg.content) {
      if (
        p?.type === 'tool-approval-request' &&
        typeof p.approvalId === 'string' &&
        typeof p.toolCallId === 'string'
      ) {
        approvalIdToToolCallId.set(p.approvalId, p.toolCallId)
      }
    }

    // Scan the whole run of consecutive tool messages, not just messages[i+1]:
    // the SDK appends an approved HITL execution's result as a NEW tool
    // message after the approval-response message, and consecutive tool
    // messages merge into one provider message anyway.
    const existing = new Set<string>()
    const responded = new Set<string>()
    let runEnd = i + 1

    while (messages[runEnd]?.role === 'tool' && Array.isArray(messages[runEnd]!.content)) {
      const isFinalMessage = runEnd === messages.length - 1

      for (const p of messages[runEnd]!.content as any[]) {
        if (p?.type === 'tool-result' && typeof p.toolCallId === 'string') {
          existing.add(p.toolCallId)
        }
        if (p?.type === 'tool-approval-response') {
          const toolCallId =
            typeof p.toolCallId === 'string'
              ? p.toolCallId
              : approvalIdToToolCallId.get(p.approvalId)

          if (typeof toolCallId === 'string') {
            responded.add(toolCallId)
            // The SDK executes approved tools only from the FINAL message of
            // the list; a response there satisfies the call like a result — a
            // synthetic would shadow the real execution and strand the
            // approval, HITL retry-looping the client. Anywhere earlier that
            // execution can no longer happen, so the call still needs a
            // result (the provider drops approval-responses, and a bare
            // toolUse block is rejected by Bedrock).
            if (isFinalMessage) existing.add(toolCallId)
          }
        }
      }
      runEnd++
    }
    // A tool-call still awaiting approval (its tool-approval-request rides in
    // the same assistant message) is not "missing a result" either — but only
    // while the approval is still actionable. If the user sent another message
    // instead of approving, no tool-approval-response can ever arrive for it,
    // and the SDK rejects the whole conversation on every retry
    // (AI_MissingToolResultsError before the next user message — session
    // 3c2e03db: one skipped approval wedged the conversation permanently).
    // Treat such stale approvals as superseded and heal them like any other
    // dangling call.
    const userMessageFollows = messages.slice(i + 1).some((m) => m?.role === 'user')
    const staleApprovals = new Set<string>()

    for (const p of msg.content) {
      if (p?.type === 'tool-approval-request' && typeof p.toolCallId === 'string') {
        if (responded.has(p.toolCallId) || existing.has(p.toolCallId)) continue
        if (userMessageFollows) {
          staleApprovals.add(p.toolCallId)
        } else {
          existing.add(p.toolCallId)
        }
      }
    }

    const synthetic = toolCalls
      .filter((c) => !existing.has(c.toolCallId))
      .map((c) => ({
        type: 'tool-result' as const,
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        output: {
          type: 'error-text' as const,
          value: staleApprovals.has(c.toolCallId)
            ? 'Tool call was not executed: it required approval, and the user continued the conversation without approving it. Do not assume it ran; ask or retry if it is still needed.'
            : 'Tool call was interrupted before completion.',
        },
      }))

    if (synthetic.length === 0) continue

    if (runEnd > i + 1) {
      ;(messages[runEnd - 1]!.content as any[]).push(...synthetic)
    } else {
      messages.splice(i + 1, 0, { role: 'tool', content: synthetic })
      i++
    }
  }
}

// Consecutive tool messages merge into ONE provider message, so two
// tool-results with the same id — a synthetic injected beside a real result
// that lives one message further, or any double delivery — become "The
// toolResult blocks at messages.N.content contain duplicate Ids" and Bedrock
// rejects the entire request (session 81815b12: every HITL approval during plan
// execution surfaced as "Agent stream failed"). Keep exactly one result per
// toolCallId, preferring a real output over an injected error-text.
export function dropDuplicateToolResults(messages: HealableMessage[]) {
  const kept = new Map<string, any>()

  for (const msg of messages) {
    if (msg?.role !== 'tool' || !Array.isArray(msg.content)) continue
    for (const p of msg.content) {
      if (p?.type !== 'tool-result' || typeof p.toolCallId !== 'string') continue
      const prev = kept.get(p.toolCallId)

      // Prefer a real output over an injected error-text for the same call.
      if (!prev || (prev.output?.type === 'error-text' && p.output?.type !== 'error-text')) {
        kept.set(p.toolCallId, p)
      }
    }
  }
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg?.role !== 'tool' || !Array.isArray(msg.content)) continue
    const parts = msg.content
    const filtered = parts.filter(
      (p) =>
        p?.type !== 'tool-result' ||
        typeof p.toolCallId !== 'string' ||
        kept.get(p.toolCallId) === p,
    )

    if (filtered.length === parts.length) continue
    if (filtered.length === 0) {
      messages.splice(i, 1)
      i--
    } else {
      msg.content = filtered
    }
  }
}
