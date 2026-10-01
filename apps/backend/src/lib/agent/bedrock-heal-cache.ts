import { toStorableJson } from '@/lib/journal/normalize'

import type { HealableMessage } from './bedrock-heal-types'

/**
 * A forced continuation crosses a streamText request boundary. Tool outputs
 * in the live SDK response may still contain JavaScript-only values such as
 * undefined, sparse array slots, Date instances, NaN, or BigInt. They are
 * legal inside an arbitrary tool implementation but not inside ModelMessage's
 * JSON schema, so passing them straight into the next request can fail before
 * the model sees the stop-gate nudge.
 *
 * Clone through the same deterministic JSON normalizer used by the audit
 * journal. This deliberately runs only at a cross-request replay boundary;
 * it never mutates the SDK's live tool-loop messages.
 */
export function normalizeMessagesForReplay(messages: HealableMessage[]): HealableMessage[] {
  const normalized = toStorableJson(messages)

  return Array.isArray(normalized) ? (normalized as HealableMessage[]) : []
}

// Prompt caching (zeabur/nuphos#407): the system prefix carries its own
// cachePoints, but without a checkpoint after the conversation the whole
// message history is re-billed at full input price on every step of the tool
// loop (~86% of chat spend in the 30d prod analysis). Keep ONE moving
// checkpoint on the last message of each request: the step reads the previous
// step's prefix from cache and writes only the delta. Stale message-level
// checkpoints from earlier steps are stripped first so the request never
// exceeds Bedrock's limit of 4 checkpoints (2 live in the system prefix).
// System messages are left alone — their checkpoints are owned by the request
// builder. Idempotent.
// Bedrock's cache lookup walks back at most ~20 content blocks from a
// checkpoint to find the previous cache entry. If one step appends more than
// that (large parallel tool fan-outs), a lone trailing checkpoint misses
// silently — no error, the whole history reprocesses at full price. Guard:
// an old checkpoint farther than this from the new tail is KEPT as the
// intermediate checkpoint (its server-side entry is exactly where the lookup
// must land); a nearer one is stripped as before. At most one intermediate
// survives, so the request stays at 2 system + 2 message checkpoints = 4.
const CACHE_LOOKBACK_SAFE_BLOCKS = 15

// Where a cache breakpoint lives in providerOptions, per provider. Passed in
// rather than read from config so this module stays importable by the smoke
// scripts, which run without the backend's full env.
export type CachePointSpec = { key: string; field: string; value: Record<string, string> }

export const BEDROCK_CACHE_POINT: CachePointSpec = {
  key: 'bedrock',
  field: 'cachePoint',
  value: { type: 'default' },
}

export const VERTEX_CACHE_POINT: CachePointSpec = {
  key: 'anthropic',
  field: 'cacheControl',
  value: { type: 'ephemeral' },
}

function contentBlockCount(msg: HealableMessage): number {
  return Array.isArray(msg.content) ? msg.content.length : 1
}

export function applyTrailingCachePoint(
  messages: HealableMessage[],
  spec: CachePointSpec,
): HealableMessage[] {
  const { key, field } = spec
  const nonSystem: HealableMessage[] = []
  const markedIndexes: number[] = []

  for (const msg of messages) {
    if (msg.role === 'system') continue
    nonSystem.push(msg)
    const bag = msg.providerOptions?.[key] as Record<string, unknown> | undefined

    if (bag && field in bag) markedIndexes.push(nonSystem.length - 1)
  }
  const last = nonSystem[nonSystem.length - 1]

  if (!last) return messages

  // Blocks between an old checkpoint and the new tail = every block after
  // the marked message (the tail checkpoint sits after the last message).
  const blocksAfter = (index: number): number => {
    let n = 0

    for (let i = index + 1; i < nonSystem.length; i++) n += contentBlockCount(nonSystem[i]!)

    return n
  }

  const strip = (msg: HealableMessage) => {
    const bag = msg.providerOptions?.[key] as Record<string, unknown> | undefined

    if (!bag || !(field in bag)) return
    delete bag[field]
    if (Object.keys(bag).length === 0) {
      delete msg.providerOptions![key]
      if (Object.keys(msg.providerOptions!).length === 0) delete msg.providerOptions
    }
  }

  let keptIntermediate = false

  for (let i = markedIndexes.length - 1; i >= 0; i--) {
    const index = markedIndexes[i]!
    const msg = nonSystem[index]!

    if (msg === last) {
      strip(msg) // re-attached below; stripping first keeps this idempotent
      continue
    }
    if (!keptIntermediate && blocksAfter(index) > CACHE_LOOKBACK_SAFE_BLOCKS) {
      keptIntermediate = true // nearest out-of-window checkpoint survives
      continue
    }
    strip(msg)
  }

  last.providerOptions ??= {}
  const opts = last.providerOptions

  opts[key] ??= {}
  const bag = opts[key] as Record<string, unknown>

  bag[field] = spec.value

  return messages
}

// Per-turn volatile status (e.g. the live plan-state block) must not live in
// the system segment: Bedrock hoists every system message into the prompt
// prefix, and a byte change there re-writes the ENTIRE cached history at
// 1.25x each turn (ADR-0002). Appending to the CURRENT turn's user message
// instead moves the mismatch point to the tail of the history — only the
// delta since the previous turn re-processes. Model-input only; the stored
// transcript never contains the block. Returns false when the last
// non-system message is not a user message (mid-turn resume shapes) — the
// caller falls back to system placement for that request.
export function appendStatusToLastUserMessage(messages: HealableMessage[], block: string): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!

    if (msg.role === 'system') continue
    if (msg.role !== 'user') return false
    if (typeof msg.content === 'string') {
      msg.content = [
        { type: 'text', text: msg.content },
        { type: 'text', text: block },
      ] as HealableMessage['content']
    } else if (Array.isArray(msg.content)) {
      ;(msg.content as unknown[]).push({ type: 'text', text: block })
    } else {
      return false
    }

    return true
  }

  return false
}
