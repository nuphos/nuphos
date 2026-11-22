/** What `/usage/query` can group and filter token usage by. */
export type UsageDimension =
  | 'member'
  | 'model'
  | 'provider'
  | 'runtime'
  | 'computer'
  | 'trigger'
  | 'source'
  | 'outcome'
  | 'conversation'
  | 'bot'

/** A usage read; any dimension set here keeps only the records with that value. */
export type TeamUsageQuery = {
  from: string
  to: string
  bucket?: 'hour' | 'day' | 'week'
  timeZone?: string
  groupBy?: UsageDimension
} & Partial<Record<UsageDimension, string>>

/** One group's tokens; `keys` holds the bucket start (`time`) and the grouped value (null = not recorded). */
export type TeamUsageRow = {
  keys: Partial<Record<UsageDimension | 'time', string | null>>
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd?: number
}

/** A grouped value's display name, where the backend knows one (people, titles, Trigger names,
 *  computer labels); null where the viewer may not see it, such as a teammate's conversation. */
export type TeamUsageNames = Partial<Record<UsageDimension, Record<string, string | null>>>

export type TeamUsageAnswer = { rows: TeamUsageRow[]; names: TeamUsageNames }
