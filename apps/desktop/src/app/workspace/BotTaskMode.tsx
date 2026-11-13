import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'

import { AgentPanel } from '../../components/agent/AgentPanel'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { useDetailSidebarTransition } from '../../hooks/useDetailSidebarTransition'
import { t } from '../../i18n'

import { CORNER_TITLEBAR_CLASS, CornerSidebarToggle } from './CornerSidebarToggle'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'
import type { AgentProvider } from '../../types/runtime'

/** The conversation in outline while the page slides in. */
function TaskSkeleton() {
  const bar = 'h-3 rounded bg-state-selected'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-6 py-6">
      <div className={`${bar} ml-auto w-48`} />
      <div className={`${bar} w-full`} />
      <div className={`${bar} w-5/6`} />
      <div className={`${bar} w-2/3`} />
      <div className="mt-auto h-24 rounded-2xl border border-line-control/60" />
    </div>
  )
}

export function BotTaskMode({
  ws,
  user,
  teamId,
  sessionId,
  onSessionChange,
  onBack,
}: {
  ws: WorkspaceController
  user: UserInfo
  teamId: string
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onBack: () => void
}) {
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<AgentProvider | undefined>()
  const corner = useWorkspacePane()?.cornerPane ?? false
  const { contentOpen, open, panelRef, requestClose } = useDetailSidebarTransition(
    onBack,
    undefined,
    { closeOnEscape: false },
  )
  // The conversation's first render is most of the cost of opening, so it waits for the slide.
  const [settled, setSettled] = useState(false)

  if (contentOpen && !settled) setSettled(true)

  return (
    <section
      ref={panelRef}
      data-open={open ? 'true' : 'false'}
      className="t-bot-task-mode workspace-content-surface absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <header
        className={`sheet-titlebar-row titlebar-drag flex flex-shrink-0 items-center gap-3 px-3 ${corner ? CORNER_TITLEBAR_CLASS : ''}`}
      >
        <CornerSidebarToggle />
        <button
          type="button"
          onClick={requestClose}
          className="titlebar-no-drag flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-secondary hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
          {t('Back to conversation')}
        </button>
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-main">
          <AgentProviderIcon provider={provider} className="size-4 shrink-0" />
          <span className="truncate">{title || t('Task')}</span>
        </div>
      </header>
      <SkeletonReveal
        ready={settled}
        skeleton={<TaskSkeleton />}
        className="flex min-h-0 flex-1 flex-col [&>*]:flex [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex-col"
      >
        <AgentPanel
          variant="page"
          open
          userName={user.name}
          teamId={teamId}
          sessionId={sessionId}
          isTeamAdmin={ws.currentTeam?.role === 'ADMINISTRATOR'}
          autoFocusComposer
          onSessionChange={(nextId) => (nextId ? onSessionChange(nextId) : requestClose())}
          onOpenNuphosLink={ws.stableOpenNuphosLinkFromChat}
          onOpenAgentSettings={() => ws.openSettingsSection('workspace.agent')}
          onTitleChange={(nextTitle, reportedId, agentRuntime) => {
            if (reportedId !== sessionId) return
            setTitle(nextTitle)
            setProvider(agentRuntime)
          }}
        />
      </SkeletonReveal>
    </section>
  )
}
