import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'

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
        if (alive) setTarget({ title: c.title || t('Untitled'), archived: Boolean(c.archivedAt) })
      })
      // A session the viewer cannot open still reads as a link.
      .catch(() => setTarget(null))

    return () => {
      alive = false
    }
  }, [teamId, sessionId])

  const [before, after] = t('Delivers to {session}').split('{session}')

  return (
    <button
      type="button"
      onClick={() => onOpen(sessionId)}
      className="flex w-full min-w-0 items-center gap-1 px-3 pt-1 text-left text-[11.5px] text-tertiary hover:text-main"
    >
      {before?.trim() && <span className="flex-shrink-0">{before.trim()}</span>}
      <span className="min-w-0 truncate text-secondary">{target?.title ?? t('a session')}</span>
      {after?.trim() && <span className="flex-shrink-0">{after.trim()}</span>}
      {target?.archived && <span className="flex-shrink-0 text-warning">{t('(archived)')}</span>}
      <ArrowRight className="h-3 w-3 flex-shrink-0" strokeWidth={2} />
    </button>
  )
}
