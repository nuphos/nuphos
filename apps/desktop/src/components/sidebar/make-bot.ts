/** What a sidebar row needs to say whether it may become a Bot. */
type BotCandidate = {
  task?: boolean
  bot?: boolean
  readOnlyChat?: boolean
  /** Set when the row nests under another chat: a sub-task. */
  parentKey?: string
}

/**
 * A Task row may become a Bot, by dropping it on Bots or from its menu. A
 * sub-task may not: as a Bot it would show both in its parent's tree and in
 * Bots, and a slip of the mouse while dragging it would give it a face, a chat
 * and a naming turn nobody asked for.
 */
export function canBecomeBot(row: BotCandidate): boolean {
  return Boolean(row.task && !row.bot && !row.readOnlyChat && !row.parentKey)
}
