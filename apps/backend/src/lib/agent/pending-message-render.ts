import { renderAttributedMessage } from './message-metadata'

import type { PendingUserMessage } from './pending-messages'

// A real user turn boundary, not a synthetic continuation. Slack-rendered
// messages already identify their author, so multiple participants remain
// distinguishable when several messages are injected together.
export function renderInjectedUserMessages(messages: PendingUserMessage[]): string {
  const bodies = messages
    .map((message) =>
      renderAttributedMessage(message.id, message.renderedText.trim(), message.metadata),
    )
    .filter(Boolean)
  const header =
    bodies.length > 1
      ? 'People sent these messages while you were still working on the previous one:'
      : 'Someone sent this while you were still working:'

  return [
    header,
    '',
    bodies.join('\n\n---\n\n'),
    '',
    'Treat each attributed message as part of this live conversation. Decide naturally whether to carry on, handle it after the current thought, redirect or cancel the work, or answer it now. Do not restart from scratch or repeat completed tool calls.',
  ].join('\n')
}
