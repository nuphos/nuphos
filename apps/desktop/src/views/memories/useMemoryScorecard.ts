import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'

import type { AgentMemoryItem, AgentMemoryScore } from '../../api'

// Per-memory retention for the Used / Last used columns and the detail pane.
// Best-effort decoration — a failed fetch leaves the plain table.
export function useMemoryScorecard(teamId: string, rows: AgentMemoryItem[]) {
  const [scores, setScores] = useState<Record<string, AgentMemoryScore>>({})
  const rowIdsKey = useMemo(() => rows.map((r) => r.id).join(','), [rows])

  useEffect(() => {
    let cancelled = false

    void api
      .agentGetMemoryScorecard(teamId, rowIdsKey ? rowIdsKey.split(',') : undefined)
      .then((res) => {
        if (cancelled) return
        setScores((prev) => ({ ...prev, ...res.scores }))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [teamId, rowIdsKey])

  return { scores }
}
