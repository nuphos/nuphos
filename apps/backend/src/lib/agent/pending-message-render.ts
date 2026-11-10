import { renderAttributedMessage } from './message-metadata'

import type { PendingUserMessage } from './pending-messages'

// Messages that waited for this turn, each with its own metadata block: the
// block says who sent it, so no framing guesses that a person did.
export function renderInjectedUserMessages(messages: PendingUserMessage[]): string {
  return messages
    .map((message) =>
      renderAttributedMessage(message.id, message.renderedText.trim(), message.metadata),
    )
    .filter(Boolean)
    .join('\n\n---\n\n')
}
