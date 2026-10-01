import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'

import type { AgentMemoryItem, AgentMemoryScore, AgentMemoryScorecard } from '../../api'

// Track A 2.3 scorecard: pool health (header strip) + per-memory retention
// (Used / Last used columns, detail pane). Best-effort decoration — a
// failed fetch leaves the plain table.
export function useMemoryScorecard(teamId: string, rows: AgentMemoryItem[]) {
  const [summary, setSummary] = useState<AgentMemoryScorecard['summary'] | null>(null)
  const [scores, setScores] = useState<Record<string, AgentMemoryScore>>({})
  const rowIdsKey = useMemo(() => rows.map((r) => r.id).join(','), [rows])

  useEffect(() => {
    let cancelled = false

    void api
      .agentGetMemoryScorecard(teamId, rowIdsKey ? rowIdsKey.split(',') : undefined)
      .then((res) => {
        if (cancelled) return
        setSummary(res.summary)
        setScores((prev) => ({ ...prev, ...res.scores }))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [teamId, rowIdsKey])

  return { summary, scores }
}
