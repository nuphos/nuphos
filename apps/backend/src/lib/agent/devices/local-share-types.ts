/** How far an owner lets teammates use their own computer's Local Agent; see local-share. */
export type LocalShareLevel = 'off' | 'approve' | 'full'

export const LOCAL_SHARE_LEVELS: readonly LocalShareLevel[] = ['off', 'approve', 'full']

/** One team's share on a person's own computer. */
export type LocalAgentShare = {
  teamId: string
  level: Exclude<LocalShareLevel, 'off'>
  everyone: boolean
  userIds: string[]
}

/** A team's stored ceiling; unset means owners may share with their approval of each conversation. */
export function localShareCeiling(value: unknown): LocalShareLevel {
  return LOCAL_SHARE_LEVELS.find((level) => level === value) ?? 'approve'
}

/** A conversation's own turns and control calls, which a shared computer accepts; see local-share. */
export type SharedLocalRuntimeUse = {
  /** The conversation the call is for; absent when there is none yet (a move, a lookup). */
  sessionId?: string
  /** Where the conversation came from, as `metadata.source` records it. */
  source?: string
}
