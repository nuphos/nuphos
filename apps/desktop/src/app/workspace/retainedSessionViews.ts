export type SessionViewSelection = {
  teamId: string | undefined
  sessionId: string | null
  channel: boolean | undefined
  readOnly: boolean
}
export type RetainedSessionViews = {
  teamId?: string
  agent?: { sessionId: string | null; readOnly: boolean }
  channelId?: string
}

/** The two kinds of conversation are independent mounted views, not alternatives. */
export function retainSessionViews(
  previous: RetainedSessionViews,
  selection: SessionViewSelection,
): RetainedSessionViews {
  const base = previous.teamId === selection.teamId ? previous : { teamId: selection.teamId }

  if (!selection.teamId || selection.channel === undefined) return base
  if (selection.channel) {
    if (!selection.sessionId || base.channelId === selection.sessionId) return base

    return { ...base, channelId: selection.sessionId }
  }
  if (base.agent?.sessionId === selection.sessionId && base.agent.readOnly === selection.readOnly)
    return base

  return { ...base, agent: { sessionId: selection.sessionId, readOnly: selection.readOnly } }
}
