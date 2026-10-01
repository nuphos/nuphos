import { AgentHistoryPage } from '../../components/agent/AgentPanel'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

import type { AgentConversation } from '../../api'

const COLUMN_WIDTH = 320

/**
 * Every conversation this trigger has fired, beside the one being read.
 *
 * Deliberately the same component the Chats rail uses: a run is an ordinary
 * conversation, and reading one should feel like reading any other. All this
 * adds is the listing it asks for — trigger runs instead of chats, which the
 * backend treats as disjoint sets.
 */
export function TriggerRunsList({
  teamId,
  triggerIds,
  schedule,
  query,
  refreshKey,
  selectedSessionId,
  onOpenRun,
  onListLoaded,
}: {
  teamId: string
  /** One trigger, or every partition trigger of a Watch group. */
  triggerIds: string[]
  /** Human-readable schedule, shown above the list. */
  schedule?: string
  /** The workspace toolbar's search box — the app has one, in one place. */
  query: string
  /** Bumped after a manual fire so the new run appears without a page refresh. */
  refreshKey?: number
  selectedSessionId: string | null
  onOpenRun: (sessionId: string, title: string) => void
  /** Lets the page open the newest run on arrival instead of an empty reader. */
  onListLoaded?: (items: AgentConversation[]) => void
}) {
  const { isActive } = useWorkspaceTab()

  return (
    <div
      className="flex h-full min-h-0 flex-shrink-0 flex-col border-r border-zGray-800/70"
      style={{ width: COLUMN_WIDTH }}
    >
      {/* What produces this list. The trigger's name is on the breadcrumb, so
          the only thing left worth saying here is what makes it fire. */}
      {schedule && (
        <div
          className="flex-shrink-0 truncate px-3 pt-2.5 text-[11.5px] text-tertiary"
          title={schedule}
        >
          {schedule}
        </div>
      )}
      <AgentHistoryPage
        teamId={teamId}
        refreshKey={refreshKey}
        query={query}
        openingSessionId={null}
        selectedSessionId={selectedSessionId}
        layout="rail"
        triggerIds={triggerIds}
        // Runs belong to whoever the trigger executes as, which is rarely the
        // viewer — scoping to 'mine' would leave most run lists empty.
        historyScope="team"
        onOpenConversation={(sessionId, titleHint) => onOpenRun(sessionId, titleHint ?? 'Run')}
        onListLoaded={onListLoaded}
        keyboardNavigation={isActive}
      />
    </div>
  )
}
