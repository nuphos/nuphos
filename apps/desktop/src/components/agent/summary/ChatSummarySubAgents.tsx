import { t } from '../../../i18n'
import { setSubAgentsFilter, useSubAgentsFilter } from '../../../lib/chatSummaryPanel'

import { filterSubAgents, shownSubAgentsFilter, subAgentsFilterOptions } from './chatSummaryModel'
import { SummarySection, ThreadRow } from './ChatSummaryRows'
import { FilterPills } from './SummaryFilterPills'

import type { SubAgent } from './chatSummaryModel'

/** Threads this chat started, with an Active and Done filter shared by the window, as Changes has. */
export function SubAgentsSection({
  subAgents,
  onOpen,
}: {
  subAgents: SubAgent[]
  onOpen: (sessionId: string) => void
}) {
  const stored = useSubAgentsFilter()
  const options = subAgentsFilterOptions(subAgents)
  const filter = shownSubAgentsFilter(stored, options)

  return (
    <SummarySection
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
