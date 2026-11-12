/** A focused turn's result stays pending until leaving it or starting another turn. */
export function nextReplyInbox(
  pending: ReadonlySet<string>,
  previousWorking: ReadonlySet<string>,
  working: ReadonlySet<string>,
  openId: string | undefined,
  previousUnread: ReadonlySet<string> = new Set(),
): Set<string> {
  const next = new Set<string>()

  if (
    openId &&
    !working.has(openId) &&
    (pending.has(openId) || previousWorking.has(openId) || previousUnread.has(openId))
  )
    next.add(openId)

  return next
}
