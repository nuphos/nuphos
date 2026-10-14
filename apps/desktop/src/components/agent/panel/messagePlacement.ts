/**
 * Where something that happened at `at` sits among the loaded messages: the
 * index of the first message newer than it, or -1 when none is. That slot is
 * right after the last message stamped at or before `at`. A message without a
 * stamp has not been stored yet — the reply still streaming, or one whose
 * stored time has not been read back — so it is never measured against; it
 * counts as newer than every stamped message before it and older than the
 * next stamped one. The one rule timeline events and download cards share, so
 * an item keeps its place when a stamp arrives.
 */
export function firstMessageNewerThan(
  messages: readonly { createdAt?: number }[],
  at: number,
): number {
  const index =
    messages.findLastIndex(
      (message) => message.createdAt !== undefined && message.createdAt <= at,
    ) + 1

  return index < messages.length ? index : -1
}
