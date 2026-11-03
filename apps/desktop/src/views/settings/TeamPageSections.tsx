import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { SearchBox } from '../../components/Toolbar'
import { Button } from '../../components/ui/button'
import { ToolbarSlotsContext } from '../../hooks/useToolbarControls'
import { ToolbarPrimaryActionContext } from '../../hooks/useToolbarPrimaryAction'
import { WorkspaceTabContext } from '../../hooks/useWorkspaceTab'
import { t } from '../../i18n'
import { AgentMemoriesView } from '../AgentMemoriesView'
import { TeamSkillsView } from '../TeamSkillsView'
import { TriggersView } from '../TriggersView'

import type { ToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import type { TriggerFormRef } from '../../lib/app-routes/types'
import type { ReactNode } from 'react'

type OpenAgentChat = (prompt: string, options?: { send?: boolean }) => void

type PageProps = {
  teamId: string | undefined
  currentUserId: string
  onOpenAgentChat?: OpenAgentChat
}

// The page views read whether their tab is in front; inside Settings it always is.
const SETTINGS_TAB = { tabId: 'settings', refreshKey: 0, pollTick: 0, isActive: true }
const noop = () => {}

/**
 * A workspace team page hosted in Settings: the header, and the one controls
 * row the page portals its filters and actions into — the same slots and
 * primary action the workspace toolbar offers it, so the page itself is reused
 * unchanged.
 */
function SettingsPageFrame({
  title,
  subtitle,
  onBack,
  searchable = true,
  filter,
  onFilterChange,
  count,
  children,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  /** Hide the search where there is nothing to filter, such as a form. */
  searchable?: boolean
  filter: string
  onFilterChange: (filter: string) => void
  count: number
  children: ReactNode
}) {
  const [left, setLeft] = useState<HTMLElement | null>(null)
  const [right, setRight] = useState<HTMLElement | null>(null)
  const [primaryAction, setPrimaryAction] = useState<ToolbarPrimaryAction | null>(null)
  const slots = useMemo(
    () => ({ left, right, headerRight: null, setOccupied: noop, setHeaderRightOccupied: noop }),
    [left, right],
  )

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-main">
      <PageHeader
        title={title}
        subtitle={subtitle}
        leading={
          onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('Back')}
              // Keep the header as tall as it is without the button.
              className="-my-1"
              onClick={onBack}
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            </Button>
          )
        }
      />
      {/* Shown only while something is in it: a form has no search and no controls. */}
      <div className="hidden h-[42px] flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 px-6 has-[>:not(:empty)]:flex">
        {searchable && <SearchBox filter={filter} onFilterChange={onFilterChange} count={count} />}
        <div ref={setLeft} className="flex min-w-0 items-center gap-1 empty:hidden" />
        <div className="flex-1" />
        <div ref={setRight} className="flex items-center gap-2 empty:hidden" />
        {primaryAction && (
          <Button
            size="sm"
            type="button"
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
          >
            <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
            {primaryAction.label}
          </Button>
        )}
      </div>
      <WorkspaceTabContext.Provider value={SETTINGS_TAB}>
        <ToolbarPrimaryActionContext.Provider value={setPrimaryAction}>
          <ToolbarSlotsContext.Provider value={slots}>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </ToolbarSlotsContext.Provider>
        </ToolbarPrimaryActionContext.Provider>
      </WorkspaceTabContext.Provider>
    </div>
  )
}

export function NoTeam() {
  return (
    <div className="max-w-[640px] mx-auto py-10 px-8 text-[13px] text-tertiary">
      {t('No workspace selected.')}
    </div>
  )
}

export function SkillsSection({
  teamId,
  currentUserId,
  onOpenAgentChat,
  initialFilter = '',
}: PageProps & { initialFilter?: string }) {
  const [filter, setFilter] = useState(initialFilter)
  const [count, setCount] = useState(0)

  if (!teamId) return <NoTeam />

  return (
    <SettingsPageFrame title={t('Skills')} filter={filter} onFilterChange={setFilter} count={count}>
      <TeamSkillsView
        teamId={teamId}
        currentUserId={currentUserId}
        refreshKey={0}
        filter={filter}
        onCount={setCount}
        onOpenAgentChat={onOpenAgentChat}
      />
    </SettingsPageFrame>
  )
}

export function MemoriesSection({ teamId, onOpenAgentChat }: Omit<PageProps, 'currentUserId'>) {
  const [filter, setFilter] = useState('')
  const [count, setCount] = useState(0)

  if (!teamId) return <NoTeam />

  return (
    <SettingsPageFrame
      title={t('Memories')}
      filter={filter}
      onFilterChange={setFilter}
      count={count}
    >
      <AgentMemoriesView
        teamId={teamId}
        filter={filter}
        refreshKey={0}
        onCount={setCount}
        onOpenAgentChat={onOpenAgentChat}
      />
    </SettingsPageFrame>
  )
}

export function TriggersSection({ teamId, currentUserId, onOpenAgentChat }: PageProps) {
  const [filter, setFilter] = useState('')
  const [count, setCount] = useState(0)
  const [detail, setDetail] = useState<{ triggerId: string; triggerName: string } | null>(null)
  const [form, setForm] = useState<TriggerFormRef | null>(null)

  if (!teamId) return <NoTeam />
  let title = t('Triggers')
  let back: (() => void) | undefined

  // Leaving a form returns to the trigger it was opened from, if any.
  if (form) {
    title = form.kind === 'create' ? t('New trigger') : form.name
    back = () => setForm(null)
  } else if (detail) {
    title = detail.triggerName
    back = () => setDetail(null)
  }

  return (
    <SettingsPageFrame
      title={title}
      onBack={back}
      searchable={!form}
      filter={filter}
      onFilterChange={setFilter}
      count={count}
    >
      <TriggersView
        teamId={teamId}
        currentUserId={currentUserId}
        filter={filter}
        onCount={setCount}
        triggerDetail={detail}
        setTriggerDetail={setDetail}
        triggerForm={form}
        setTriggerForm={setForm}
        onOpenAgentChat={onOpenAgentChat}
      />
    </SettingsPageFrame>
  )
}
