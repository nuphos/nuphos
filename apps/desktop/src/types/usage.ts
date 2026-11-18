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
  | 'task'

export type TeamUsageQuery = {
  from: string
  to: string
  bucket?: 'hour' | 'day' | 'week'
  timeZone?: string
  groupBy?: UsageDimension
}

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
