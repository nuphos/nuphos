import { isConversationUnavailable } from '../../../api/errors.ts'

import type { OpeningConversation } from './ctx.ts'

/**
 * Where the open settles after `err`. A chat the reader can never see stays in
 * place, marked unavailable, so the pane says why instead of falling back to
 * nothing; it still counts as the open, which keeps the workspace on the link.
 * It carries no title: nothing about an unreadable chat is shown. Anything else
 * clears the open and is reported by the caller's toast, as before.
 */
export function openingAfterFailure(sessionId: string, err: unknown): OpeningConversation | null {
  return isConversationUnavailable(err) ? { sessionId, title: '', unavailable: true } : null
}
