import { byCodeUnit } from '@/lib/agent/sort-order'

/**
 * The user's most recent REAL message text: skips assistant/tool messages and
 * the synthetic `[automatic continuation …]` user turns injected by the
 * server (SYNTHETIC_CONTINUATION_USER_TEXT) and the desktop resume nudges.
 */
export function latestRealUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: unknown; content?: unknown }

    if (msg?.role !== 'user') continue
    let text = ''

    if (typeof msg.content === 'string') text = msg.content
    else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(
          (part): part is { type: string; text: string } =>
            (part as { type?: unknown })?.type === 'text' &&
            typeof (part as { text?: unknown })?.text === 'string',
        )
        .map((part) => part.text)
        .join('\n')
    }
    text = text.trim()
    if (!text || text.startsWith('[automatic continuation')) continue

    return text
  }

  return ''
}

/**
 * Consecutive same-signature failures of one tool call before the runaway
 * detector fires. Retrying with CHANGED input is healthy exploration and
 * never counts — only literal repetition of a failing call does.
 */
export const RUNAWAY_FAILURE_THRESHOLD = 3

export type RunawayDetection = { toolName: string; count: number }

/**
 * Canonical signature for a tool input: the top-level `label` field is
 * stripped (withLabel injects it as per-call PRESENTATION metadata — the
 * model words it differently on every call, so hashing it would make
 * identical retries never match and the runaway detector dead code), and
 * object keys are sorted deep so key-order variance can't split a streak.
 */
export function canonicalToolInputKey(input: unknown): string {
  try {
    return JSON.stringify(sortKeysDeep(stripTopLevelLabel(input))) ?? ''
  } catch {
    return String(input)
  }
}

function stripTopLevelLabel(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const { label: _label, ...rest } = input as Record<string, unknown>

  return rest
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}

    for (const key of Object.keys(value as Record<string, unknown>).sort(byCodeUnit)) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }

    return out
  }

  return value
}

function toolResultLooksFailed(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const o = output as { type?: unknown; value?: unknown }

  if (o.type === 'error-text' || o.type === 'error-json') return true
  if (o.type === 'json' && o.value && typeof o.value === 'object') {
    const exitCode = (o.value as { exitCode?: unknown }).exitCode

    return typeof exitCode === 'number' && exitCode !== 0
  }

  return false
}

/**
 * The stop gate's mirror twin: detects the model spinning on the SAME failing
 * tool call. Walks the step messages backwards; if the trailing consecutive
 * tool results are >= RUNAWAY_FAILURE_THRESHOLD failures of one identical
 * (toolName + input) signature, returns it. Any success, any different call,
 * or any changed input in between resets the streak. Pure — caller injects
 * the wrap-up message and owns telemetry.
 */
export function detectRunawayToolFailures(messages: unknown): RunawayDetection | null {
  if (!Array.isArray(messages)) return null
  // toolCallId → signature, from assistant tool-call parts.
  const signatures = new Map<string, { toolName: string; inputKey: string }>()

  for (const msg of messages) {
    const m = msg as { role?: unknown; content?: unknown }

    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue
    for (const part of m.content) {
      const p = part as {
        type?: unknown
        toolCallId?: unknown
        toolName?: unknown
        input?: unknown
      }

      if (p?.type !== 'tool-call' || typeof p.toolCallId !== 'string') continue
      signatures.set(p.toolCallId, {
        toolName: typeof p.toolName === 'string' ? p.toolName : 'unknown',
        inputKey: canonicalToolInputKey(p.input),
      })
    }
  }
  // Trailing consecutive failure streak over tool results, newest first.
  // A REAL user message terminates the scan: failures from a previous user
  // turn are stale — the user may have fixed the external condition and
  // legitimately wants the same call retried. Synthetic `[automatic
  // continuation …]` user turns (prefill guard, stop-gate nudges) are
  // request shaping, not a user boundary, and are walked past. Assistant
  // prose between retries never breaks the streak.
  let streak: { toolName: string; inputKey: string; count: number } | null = null

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown }

    if (m?.role === 'user') {
      const text = latestRealUserText([m])

      if (text.length > 0) return streakResult(streak)
      continue
    }
    if (m?.role !== 'tool') continue
    if (!Array.isArray(m.content)) continue
    for (let j = m.content.length - 1; j >= 0; j--) {
      const p = m.content[j] as { type?: unknown; toolCallId?: unknown; output?: unknown }

      if (p?.type !== 'tool-result' || typeof p.toolCallId !== 'string') continue
      const sig = signatures.get(p.toolCallId)

      // Orphan result (its call was healed/summarized away): unknowable —
      // skip it rather than terminating, so a real trailing streak behind a
      // healed orphan is still detected. It can never extend a streak since
      // it matches no signature.
      if (!sig) continue
      if (!toolResultLooksFailed(p.output)) return streakResult(streak)
      if (!streak) {
        streak = { ...sig, count: 1 }
      } else if (streak.toolName === sig.toolName && streak.inputKey === sig.inputKey) {
        streak.count++
      } else {
        return streakResult(streak)
      }
    }
  }

  return streakResult(streak)
}

function streakResult(streak: { toolName: string; count: number } | null): RunawayDetection | null {
  return streak && streak.count >= RUNAWAY_FAILURE_THRESHOLD
    ? { toolName: streak.toolName, count: streak.count }
    : null
}

/** Wrap-up instruction injected (once per round) when a runaway is detected. */
export function runawayWrapUpText(detection: RunawayDetection): string {
  return [
    `You have now run the same failing \`${detection.toolName}\` call ${String(detection.count)} times in a row with identical input. Stop retrying it.`,
    '',
    'Instead, wrap up:',
    '1. State exactly what you tried and the precise error you observed (quote the real output, do not paraphrase from memory).',
    '2. Give your best diagnosis of why it fails.',
    '3. Either take a materially different approach now (different command, different flags, different source of truth), or tell the user precisely what you need from them (a decision, a credential, a permission).',
    '',
    'Do not run that same call again unless something material about it has changed.',
  ].join('\n')
}
