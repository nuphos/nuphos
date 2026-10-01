import { AppError } from '@/lib/errors'

/** One app send carries one fresh user message; queued inputs have their own server path. */
export function assertSingleNewUserMessage(
  messages: { id: string; role: string }[],
  storedIds: Set<string>,
): void {
  const fresh = messages.filter((message) => message.role === 'user' && !storedIds.has(message.id))

  if (fresh.length > 1 || (fresh.length === 1 && fresh[0] !== messages.at(-1))) {
    throw new AppError(
      400,
      'invalid_message_batch',
      'Send one new user message at a time, as the final message. Reload the conversation before retrying.',
    )
  }
}
