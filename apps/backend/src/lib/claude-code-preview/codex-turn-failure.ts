import { claudeProductStateNotice } from './openab-acp-errors'

import type { UIMessage } from 'ai'

const GENERIC_FAILURE = 'The model provider ended this turn with an error.'

/**
 * A Codex turn the provider failed (a policy refusal, a provider error). The
 * pinned codex-acp adapter reports it as one final `${message}\n\n` text chunk
 * and still answers `end_turn`; only the thread's `systemError` state marks it.
 */
export class CodexTurnFailedError extends Error {
  constructor(readonly notice: string) {
    super(notice.trim() || GENERIC_FAILURE)
    this.name = 'CodexTurnFailedError'
  }

  get userMessage(): string {
    const notice = this.notice.trim()

    return notice ? `The model provider stopped this turn: ${notice}` : GENERIC_FAILURE
  }
}

/** Removes the adapter's failure notice from the answer text it was streamed into. */
export function withoutFailureNotice(text: string, error: unknown): string {
  // Claude Code streams its usage-limit and sign-in notices too; the interruption line replaces them.
  const notice =
    error instanceof CodexTurnFailedError ? error.notice : claudeProductStateNotice(error)

  if (!notice) return text
  const trimmed = text.trimEnd()

  return trimmed.endsWith(notice.trimEnd()) ? trimmed.slice(0, -notice.trimEnd().length) : text
}

export function partsWithoutFailureNotice(
  parts: UIMessage['parts'],
  error: unknown,
): UIMessage['parts'] {
  const last = parts.at(-1)

  if (last?.type !== 'text') return parts
  const text = withoutFailureNotice(last.text, error)

  if (text === last.text) return parts

  return text ? [...parts.slice(0, -1), { ...last, text }] : parts.slice(0, -1)
}

export { withoutEmptyTurnSentinel } from './empty-turn'
