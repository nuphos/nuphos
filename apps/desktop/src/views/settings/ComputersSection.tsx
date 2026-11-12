import { useState } from 'react'

import { PageAsideContext } from '../../hooks/usePageAside'
import { t } from '../../i18n'

import { AgentSection } from './AgentSection'
import { NoTeam, SettingsPageFrame } from './TeamPageSections'

import type { AtlasTeam } from '../../types'

const noop = () => {}

/** Reuses the complete computer/runtime page, including its details and Add action. */
export function ComputersSection({
  team,
  onOpenSection,
}: {
  team: AtlasTeam | undefined
  onOpenSection: (section: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [count, setCount] = useState(0)
  const [aside, setAside] = useState<HTMLDivElement | null>(null)

  if (!team) return <NoTeam />

  return (
    <SettingsPageFrame
      title={t('Computers')}
      filter={filter}
      onFilterChange={setFilter}
      count={count}
    >
      <PageAsideContext.Provider value={aside}>
        <div className="flex min-h-0 flex-1 @container">
          <AgentSection
            teamId={team.id}
            isAdmin={team.role === 'ADMINISTRATOR'}
            filter={filter}
            refreshKey={0}
            onCount={setCount}
            onLoading={noop}
            onOpenSettingsSection={onOpenSection}
          />
          <div ref={setAside} className="flex min-h-0 shrink-0" />
        </div>
      </PageAsideContext.Provider>
    </SettingsPageFrame>
  )
}
