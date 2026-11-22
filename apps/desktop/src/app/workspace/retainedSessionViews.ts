export type SessionViewSelection = {
  teamId: string | undefined
  sessionId: string | null
  channel: boolean | undefined
  readOnly: boolean
}
export type RetainedSessionViews = {
  teamId?: string
  agent?: { sessionId: string | null; readOnly: boolean }
  /** Bot chats opened most recently, the open one last. */
  channelIds?: string[]
}

/** The open Bot chat and the two before it stay mounted, so switching back among them is instant. */
const RETAINED_CHANNELS = 3

/** The two kinds of conversation are independent mounted views, not alternatives. */
export function retainSessionViews(
  previous: RetainedSessionViews,
  selection: SessionViewSelection,
): RetainedSessionViews {
  const base = previous.teamId === selection.teamId ? previous : { teamId: selection.teamId }

  if (!selection.teamId || selection.channel === undefined) return base
  if (selection.channel) {
    const channelIds = base.channelIds ?? []

    if (!selection.sessionId || channelIds.at(-1) === selection.sessionId) return base

    return {
      ...base,
      channelIds: [
        ...channelIds.filter((id) => id !== selection.sessionId),
        selection.sessionId,
      ].slice(-RETAINED_CHANNELS),
    }
  }
  if (base.agent?.sessionId === selection.sessionId && base.agent.readOnly === selection.readOnly)
    return base

  return { ...base, agent: { sessionId: selection.sessionId, readOnly: selection.readOnly } }
}
