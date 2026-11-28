import { t } from '../../../i18n'
import { setSubAgentsFilter, useSubAgentsFilter } from '../../../lib/chatSummaryPanel'

import { filterSubAgents, shownSubAgentsFilter, subAgentsFilterOptions } from './chatSummaryModel'
import { SummarySection } from './ChatSummaryRows'
import { SubtaskList } from './SubtaskList'
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
      title={t('Sub-tasks')}
      header={
        options.length > 0 && (
          <FilterPills
            label={t('Filter sub-tasks by status')}
            options={options}
            selected={filter}
            onSelect={setSubAgentsFilter}
          />
        )
      }
    >
      <SubtaskList key={filter} subAgents={filterSubAgents(subAgents, filter)} onOpen={onOpen} />
    </SummarySection>
  )
}
