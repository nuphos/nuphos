// NUPS-607: build the TurnDigest's message list from a finished AI SDK turn,
// tool activity included. Until this existed the digest carried only the
// user/assistant text pair, which is where the distiller was structurally
// blind: an investigation turn ("which cluster runs the usage ClickHouse?")
// holds its durable knowledge in the tool results, and the prose answer is
// often a summary that omits the identifiers worth remembering.
//
// The runtime — not the provider — owns redaction and caps here, per the
// ToolCallDigest contract in types.ts ("secrets already redacted by the
// runtime"). Providers receive tool activity already safe to forward to a
// model.
import { redactSecrets } from '@/lib/journal/redact'

import type { ToolCallDigest, TurnMessageDigest } from './types'

/** Keep the LAST N calls when a turn ran long: a multi-step investigation
 * converges, so the closing calls carry the conclusion while the opening ones
 * are discovery noise. */
const MAX_TOOL_CALLS = 24
const MAX_ARGUMENT_CHARS = 400
const MAX_OUTPUT_CHARS = 800
/** Whole-turn ceiling for tool text, enforced after per-item caps so one
 * chatty tool cannot crowd out every other call's evidence. */
const MAX_TOOL_TEXT_CHARS = 6_000

/** Skill loading is scaffolding, not work: the output is a prompt document,
 * so it burns the budget and hands the distiller a wall of instruction-shaped
 * text (the prompt already declares tool output DATA, but not feeding it a
 * skill body is cheaper than relying on that). */
const IGNORED_TOOL_NAMES = new Set(['skill'])

type RawCall = { id: string; name: string; input: unknown }

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** Redact first, then truncate — slicing first can cut a secret in half and
 * leave the surviving fragment unmatched by the pattern rules. */
function safeText(value: unknown, limit: number): string {
  return redactSecrets(stringify(value)).redacted.slice(0, limit)
}

/** Tool calls reach the finalizer by two paths and neither alone is complete:
 * `steps[]` misses the native HITL approval pre-step (the SDK executes an
 * approved call BEFORE step 0), and `response.messages` is the round's view.
 * Same reason mergeToolResultCounts exists on the stop-gate side. */
function collectCalls(event: unknown): RawCall[] {
  const out: RawCall[] = []
  const seen = new Set<string>()
  const add = (id: unknown, name: unknown, input: unknown) => {
    if (typeof id !== 'string' || !id || seen.has(id)) return
    const toolName = typeof name === 'string' && name ? name : 'unknown'

    if (IGNORED_TOOL_NAMES.has(toolName)) return
    seen.add(id)
    out.push({ id, name: toolName, input })
  }

  const source = event as Record<string, any> | null | undefined

  for (const step of asArray(source?.steps)) {
    for (const call of asArray((step as any)?.toolCalls)) {
      const raw = call as any

      add(
        raw?.toolCallId ?? raw?.toolCall?.toolCallId,
        raw?.toolName ?? raw?.toolCall?.toolName,
        raw?.input ?? raw?.args,
      )
    }
  }

  for (const message of asArray(source?.response?.messages)) {
    const raw = message as any

    if (raw?.role !== 'assistant') continue
    for (const part of asArray(raw.content)) {
      const p = part as any

      if (p?.type !== 'tool-call') continue
      add(p.toolCallId, p.toolName, p.input ?? p.args)
    }
  }

  return out
}

/** On the `response.messages` path the SDK wraps tool output in the
 * ToolResultOutput union ({type:'text'|'json'|…, value}) — the raw execute()
 * return only flows through `steps[].toolResults`. Unwrap the known variants
 * so HITL pre-step results (which exist ONLY in messages) carry the actual
 * value instead of wrapper JSON (PR #711 review F5). */
function unwrapModelOutput(output: unknown): unknown {
  const o = output as Record<string, any> | null | undefined

  switch (o?.type) {
    case 'text':
    case 'json':
    case 'error-text':
    case 'error-json':
      return o.value
    case 'execution-denied':
      return typeof o.reason === 'string' && o.reason
        ? `execution denied: ${o.reason}`
        : 'execution denied'
    case 'content':
      return asArray(o.value)
        .map((part) => {
          const p = part as Record<string, any> | null | undefined

          return p?.type === 'text' ? String(p.text ?? '') : `[${String(p?.type ?? 'media')}]`
        })
        .join('\n')
    default:
      return output
  }
}

function collectResults(event: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>()
  const source = event as Record<string, any> | null | undefined
  const add = (id: unknown, output: unknown) => {
    if (typeof id !== 'string' || !id || out.has(id)) return
    out.set(id, output)
  }

  for (const step of asArray(source?.steps)) {
    for (const result of asArray((step as any)?.toolResults)) {
      const raw = result as any

      add(
        raw?.toolCallId ?? raw?.toolCall?.toolCallId,
        raw?.output ?? raw?.result ?? raw?.content ?? raw?.toolResult?.output,
      )
    }
  }

  for (const message of asArray(source?.response?.messages)) {
    const raw = message as any

    if (raw?.role !== 'tool') continue
    for (const part of asArray(raw.content)) {
      const p = part as any

      if (p?.type !== 'tool-result') continue
      add(p.toolCallId, unwrapModelOutput(p.output ?? p.result))
    }
  }

  return out
}

/** The assistant turn plus its tool activity, in SPI shape. `user` and
 * `assistant` text are passed in rather than re-derived: the caller already
 * owns exactly which user message the turn answered (`memoryQuery`). */
export function buildTurnDigestMessages(
  event: unknown,
  turn: { query: string; answer: string },
): TurnMessageDigest[] {
  const calls = collectCalls(event).slice(-MAX_TOOL_CALLS)
  const results = collectResults(event)

  const toolCalls: ToolCallDigest[] = []
  const toolMessages: Extract<TurnMessageDigest, { role: 'tool' }>[] = []
  let spent = 0

  for (const call of calls) {
    const args = safeText(call.input, MAX_ARGUMENT_CHARS)

    if (spent + args.length > MAX_TOOL_TEXT_CHARS) break
    spent += args.length
    toolCalls.push({ id: call.id, name: call.name, arguments: args })

    if (!results.has(call.id)) continue
    const output = safeText(results.get(call.id), MAX_OUTPUT_CHARS)

    if (!output) continue
    if (spent + output.length > MAX_TOOL_TEXT_CHARS) break
    spent += output.length
    toolMessages.push({ role: 'tool', toolCallId: call.id, content: output })
  }

  // The prose pair gets the same redaction as tool text: a user pasting a
  // connection string (or the assistant echoing one) must not reach the
  // distiller verbatim — that is exactly what the store's secret gate later
  // rejects, costing the turn its entire learning.
  return [
    { role: 'user', content: redactSecrets(turn.query).redacted },
    {
      role: 'assistant',
      content: redactSecrets(turn.answer).redacted,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    ...toolMessages,
  ]
}

/** Pair each digested call with its result — the shape a distiller wants,
 * reconstructed from the flat SPI message list. */
export function toolActivityFromDigest(
  messages: TurnMessageDigest[],
): { name: string; arguments: string; output: string }[] {
  const outputs = new Map(
    messages.flatMap((m) => (m.role === 'tool' ? [[m.toolCallId, m.content] as const] : [])),
  )

  return messages.flatMap((m) =>
    m.role === 'assistant'
      ? (m.toolCalls ?? []).map((c) => ({
          name: c.name,
          arguments: c.arguments,
          output: outputs.get(c.id) ?? '',
        }))
      : [],
  )
}
