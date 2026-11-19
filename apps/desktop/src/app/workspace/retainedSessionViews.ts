export type SessionViewSelection = {
  teamId: string | undefined
  sessionId: string | null
  channel: boolean | undefined
  readOnly: boolean
}
export type RetainedSessionViews = {
  teamId?: string
  agent?: { sessionId: string | null; readOnly: boolean }
  /** The Bot chats kept mounted, most recent last; the selected one is shown. */
  channelIds?: string[]
}

// Like a Task's retained tabs: switching back to one of these is a frame, not a mount.
const RETAINED_CHANNELS = 3

/** The two kinds of conversation are independent mounted views, not alternatives. */
export function retainSessionViews(
  previous: RetainedSessionViews,
  selection: SessionViewSelection,
): RetainedSessionViews {
  const base = previous.teamId === selection.teamId ? previous : { teamId: selection.teamId }

  if (!selection.teamId || selection.channel === undefined) return base
  if (selection.channel) {
    const id = selection.sessionId
    const ids = base.channelIds ?? []

    if (!id || ids.at(-1) === id) return base

    return {
      ...base,
      channelIds: [...ids.filter((kept) => kept !== id), id].slice(-RETAINED_CHANNELS),
    }
  }
  if (base.agent?.sessionId === selection.sessionId && base.agent.readOnly === selection.readOnly)
    return base

  return { ...base, agent: { sessionId: selection.sessionId, readOnly: selection.readOnly } }
}
