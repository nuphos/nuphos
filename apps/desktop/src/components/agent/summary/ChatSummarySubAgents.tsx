import { useEffect, useRef } from 'react'

import { t } from '../../../i18n'
import {
  setSubAgentsFilter,
  takeSubAgentsReveal,
  useSubAgentsFilter,
  useSummaryRevealRequest,
} from '../../../lib/chatSummaryPanel'

import { filterSubAgents, shownSubAgentsFilter, subAgentsFilterOptions } from './chatSummaryModel'
import { SummarySection, ThreadRow } from './ChatSummaryRows'
import { revealSection } from './revealSection'
import { FilterPills } from './SummaryFilterPills'

import type { SubAgent } from './chatSummaryModel'

/**
 * Threads this chat started, with an Active and Done filter shared by the
 * window, as Changes has. When a badge opens the panel on this chat's
 * sub-agents, the list scrolls into view and the chosen filter takes focus.
 */
export function SubAgentsSection({
  sessionId,
  subAgents,
  onOpen,
}: {
  sessionId: string
  subAgents: SubAgent[]
  onOpen: (sessionId: string) => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const stored = useSubAgentsFilter()
  const revealRequest = useSummaryRevealRequest()
  const options = subAgentsFilterOptions(subAgents)
  const filter = shownSubAgentsFilter(stored, options)

  useEffect(() => {
    const section = sectionRef.current

    if (section && takeSubAgentsReveal(sessionId)) revealSection(section)
  }, [revealRequest, sessionId])

  return (
    <SummarySection
      ref={sectionRef}
      title={t('Sub-agents')}
      header={
        options.length > 0 && (
          <FilterPills
            label={t('Filter sub-agents by status')}
            options={options}
            selected={filter}
            onSelect={setSubAgentsFilter}
          />
        )
      }
    >
      {filterSubAgents(subAgents, filter).map(({ conversation, state }) => (
        <ThreadRow
          key={conversation.sessionId}
          conversation={conversation}
          state={state}
          onOpen={onOpen}
        />
      ))}
    </SummarySection>
  )
}
