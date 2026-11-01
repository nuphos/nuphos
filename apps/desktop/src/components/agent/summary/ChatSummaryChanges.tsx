import { useEffect, useRef } from 'react'

import { t } from '../../../i18n'
import {
  setChangesFilter,
  takeChangesReveal,
  useChangesFilter,
  useSummaryRevealRequest,
} from '../../../lib/chatSummaryPanel'

import { changesFilterOptions, filterChanges, shownChangesFilter } from './chatSummaryModel'
import { ChangeRow, SummarySection } from './ChatSummaryRows'
import { revealSection } from './revealSection'
import { FilterPills } from './SummaryFilterPills'

import type { SessionResource } from '../../../api/session-resource-types'

/**
 * Pull requests and issues with a status filter. The filter is shared by the
 * window; one that matches nothing in this chat shows All without being reset.
 * When the merged badge opens the panel for this chat, the list scrolls into
 * view and the chosen filter, or the first change, takes focus.
 */
export function ChangesSection({
  sessionId,
  changes,
  onOpen,
}: {
  sessionId: string
  changes: SessionResource[]
  onOpen: (url: string, external: boolean) => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const stored = useChangesFilter()
  const revealRequest = useSummaryRevealRequest()
  const options = changesFilterOptions(changes)
  const filter = shownChangesFilter(stored, options)

  useEffect(() => {
    const section = sectionRef.current

    if (section && takeChangesReveal(sessionId)) revealSection(section)
  }, [revealRequest, sessionId])

  return (
    <SummarySection
      ref={sectionRef}
      title={t('Changes')}
      header={
        options.length > 0 && (
          <FilterPills
            label={t('Filter changes by status')}
            options={options}
            selected={filter}
            onSelect={setChangesFilter}
          />
        )
      }
    >
      {filterChanges(changes, filter).map((resource) => (
        <ChangeRow key={resource.id} resource={resource} onOpen={onOpen} />
      ))}
    </SummarySection>
  )
}
