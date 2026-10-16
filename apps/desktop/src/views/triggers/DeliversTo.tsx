import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'

/** Where a bound trigger's fires land; its runs list keeps the history from before. */
export function DeliversTo({
  teamId,
  sessionId,
  onOpen,
}: {
  teamId: string
  sessionId: string
  onOpen: (sessionId: string) => void
}) {
  const [target, setTarget] = useState<{ title: string; archived: boolean } | null>(null)

  useEffect(() => {
    let alive = true

    api
      .agentGetConversation(sessionId, teamId, { tail: 1, runtimeState: 'omit' })
      .then((c) => {
        if (alive) setTarget({ title: c.title || 'Untitled', archived: Boolean(c.archivedAt) })
      })
      // A session the viewer cannot open still reads as a link.
      .catch(() => setTarget(null))

    return () => {
      alive = false
    }
  }, [teamId, sessionId])

  return (
    <button
      type="button"
      onClick={() => onOpen(sessionId)}
      className="flex w-full min-w-0 items-center gap-1 px-3 pt-1 text-left text-[11.5px] text-tertiary hover:text-main"
    >
      <span className="flex-shrink-0">Delivers to</span>
      <span className="min-w-0 truncate text-secondary">{target?.title ?? 'a session'}</span>
      {target?.archived && <span className="flex-shrink-0 text-warning">(archived)</span>}
      <ArrowRight className="h-3 w-3 flex-shrink-0" strokeWidth={2} />
    </button>
  )
}
