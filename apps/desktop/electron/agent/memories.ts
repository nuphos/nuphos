import { callJson } from './http'

export type MemoryListItem = {
  id: string
  type: 'fact' | 'artifact' | 'episode'
  text: string
  categories: string[]
  createdAt: string
  updatedAt: string
  convId: string | null
  userId: string | null
  appId: string | null
  groupIds: string[]
  // Present only on state=removed listings (ADR-0005 restore flow).
  disabledAt?: string
  disabledBy?: string
  // Present only on team Genes (ADR-0007 #4): structured strategy sections.
  gene?: {
    title: string
    triggerSignals: string[]
    investigationPath: { action: string; check: string; nextWhen?: string }[]
    traps: string[]
    doNotUseWhen: string[]
    status: string
    revision?: number
  }
}

export type MemoryListPage = {
  enabled: boolean
  memories: MemoryListItem[]
  nextCursor: string | null
  hasMore: boolean
}

export type MemoryScope = 'personal' | 'team'

export type MemoryIngestEventItem = {
  id: string
  type: 'fact' | 'artifact' | 'episode'
  text: string
  categories: string[]
  scopes: MemoryScope[]
  createdAt: string
  updatedAt: string
}

export type MemoryIngestEventPage = {
  enabled: boolean
  status?: 'pending' | 'ok'
  memories: MemoryIngestEventItem[]
}

export async function listMemories(
  cursor?: string,
  limit?: number,
  teamId?: string,
  scope: MemoryScope = 'personal',
  state?: 'live' | 'removed',
): Promise<MemoryListPage> {
  const params = new URLSearchParams()

  if (cursor) params.set('cursor', cursor)
  if (limit) params.set('limit', String(limit))
  if (teamId) params.set('teamId', teamId)
  params.set('scope', scope)
  if (state === 'removed') params.set('state', 'removed')
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<MemoryListPage>('GET', `/agent/memories${q}`)
}

export async function restoreMemory(
  memoryId: string,
  teamId?: string,
  scope: MemoryScope = 'personal',
): Promise<void> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  params.set('scope', scope)
  const q = params.toString() ? `?${String(params)}` : ''

  await callJson<{ ok: boolean }>(
    'POST',
    `/agent/memories/${encodeURIComponent(memoryId)}/restore${q}`,
  )
}

export async function getMemory(
  memoryId: string,
  teamId?: string,
  scope: MemoryScope = 'personal',
): Promise<MemoryListItem> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  params.set('scope', scope)
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<MemoryListItem>('GET', `/agent/memories/${encodeURIComponent(memoryId)}${q}`)
}

export async function getMemoryIngestEvent(
  sessionId: string,
  teamId?: string,
  eventId?: string,
  turnKey?: string,
): Promise<MemoryIngestEventPage> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  if (eventId) params.set('eventId', eventId)
  if (turnKey) params.set('turnKey', turnKey)
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<MemoryIngestEventPage>(
    'GET',
    `/agent/memories/ingest/${encodeURIComponent(sessionId)}${q}`,
  )
}

export type MemoryAttributionRow = {
  memoryId: string
  tier: 'recalled' | 'fetched' | 'considered' | 'applied' | 'not_applicable'
  turnKey: string
}

// Track A: per-turn attribution tiers for the provenance ribbon's badges.
// Fetched lazily — the judge lands after the SSE stream closes.
export async function getMemoryAttribution(
  sessionId: string,
  teamId?: string,
  turnKey?: string,
): Promise<{ rows: MemoryAttributionRow[] }> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  if (turnKey) params.set('turnKey', turnKey)
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<{ rows: MemoryAttributionRow[] }>(
    'GET',
    `/agent/memories/attribution/${encodeURIComponent(sessionId)}${q}`,
  )
}

export type MemoryScorecard = {
  summary: {
    windowDays: number
    learnedLast7d: number
    turns: {
      total: number
      withRecall: number
      withApplied: number
      recallRate: number
      zeroRecallRate: number
      appliedRate: number
    }
    judge: {
      ran: number
      failed: number
      pending: number
      skippedDisabled: number
      skippedZeroCandidates: number
      ranRate: number
    }
    distill: Record<string, number>
  }
  scores: Record<
    string,
    {
      turns: number
      applied: number
      applyRate: number
      corrections: number
      reachConversations: number
      reachUsers: number
      lastAppliedAt: string | null
      proven: boolean
    }
  >
}

// Track A 2.3: pool health + per-memory retention for the Memories view.
export async function getMemoryScorecard(
  teamId?: string,
  ids?: string[],
): Promise<MemoryScorecard> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  if (ids?.length) params.set('ids', ids.slice(0, 100).join(','))
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<MemoryScorecard>('GET', `/agent/memories/scorecard${q}`)
}

export async function deleteMemory(
  memoryId: string,
  teamId?: string,
  scope: MemoryScope = 'personal',
  reason?: string,
): Promise<void> {
  const params = new URLSearchParams()

  if (teamId) params.set('teamId', teamId)
  params.set('scope', scope)
  const q = params.toString() ? `?${String(params)}` : ''

  // Reason rides the JSON body, never the URL — free-form human text must
  // not end up in access logs / proxies / tunnel logs.
  await callJson<{ ok: boolean }>(
    'DELETE',
    `/agent/memories/${encodeURIComponent(memoryId)}${q}`,
    reason?.trim() ? { reason: reason.trim() } : undefined,
  )
}
