import clsx from 'clsx'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { LOCAL_AGENT_CARD, LocalAgentCard } from './LocalAgentCard'
import { LocalRuntimeActivity } from './LocalRuntimeActivity'
import { SectionHeader } from './shared'

import type { LocalAgentProvider, LocalRuntimeState } from '../../api'

const STATE_POLL_MS = 3_000
const PROVIDERS: LocalAgentProvider[] = ['claude-code', 'codex']

function Bar({ className }: { className: string }) {
  return <div className={clsx('h-3 rounded bg-zGray-800/60', className)} />
}

function AgentCardSkeleton() {
  return (
    <div className={LOCAL_AGENT_CARD}>
      <div className="space-y-2 px-4 py-3.5">
        <Bar className="w-24" />
        <Bar className="w-full" />
        <Bar className="w-2/3" />
      </div>
      <div className="border-t border-zGray-800/60 px-4 py-3">
        <Bar className="w-48" />
      </div>
      <div className="space-y-2 border-t border-zGray-800/60 px-4 py-3">
        <Bar className="w-40" />
        <Bar className="w-72" />
      </div>
    </div>
  )
}

/** The loaded layout in outline: both agent cards and the workspace row. */
function LocalAgentSkeleton() {
  return (
    <div className="space-y-5">
      <AgentCardSkeleton />
      <AgentCardSkeleton />
      <div className={clsx(LOCAL_AGENT_CARD, 'space-y-2 px-4 py-3')}>
        <Bar className="w-32" />
        <Bar className="w-80" />
      </div>
    </div>
  )
}

export function LocalRuntimeSection({
  currentTeamId,
  onOpenConversation,
}: {
  currentTeamId?: string
  onOpenConversation?: (sessionId: string) => void
}) {
  const [state, setState] = useState<LocalRuntimeState | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await api.localRuntimeRefresh())
    } catch (err) {
      toast.apiError('Could not check the local agents', err)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      void api.localRuntimeGetState().then(
        (next) => {
          if (!cancelled) setState(next)
        },
        () => undefined,
      )

    queueMicrotask(() => void refresh())
    const timer = setInterval(poll, STATE_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh])

  return (
    <div>
      <SectionHeader
        title="Local agent"
        description="Claude Code and Codex on this computer, with your own sign-in, for your own conversations only. Always on while Nuphos is open."
      />

      <SkeletonReveal ready={state !== null} skeleton={<LocalAgentSkeleton />}>
        {state && (
          <div className="space-y-5">
            {PROVIDERS.map((provider) => (
              <LocalAgentCard
                key={provider}
                provider={provider}
                agent={state.agents[provider]}
                devBundle={state.devBundle}
                onCheck={() => void refresh()}
              />
            ))}

            {state.workspace && (
              <div
                className={clsx(
                  LOCAL_AGENT_CARD,
                  'flex items-center justify-between gap-4 px-4 py-3',
                )}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-main">Workspace folder</div>
                  <div className="truncate text-[12px] text-tertiary" title={state.workspace}>
                    {state.workspace}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void api.localRuntimeOpenWorkspace()}
                >
                  <FolderOpen strokeWidth={1.5} className="mr-1.5 h-3.5 w-3.5" />
                  Open
                </Button>
              </div>
            )}

            <LocalRuntimeActivity
              {...(currentTeamId ? { currentTeamId } : {})}
              {...(onOpenConversation ? { onOpenConversation } : {})}
            />
          </div>
        )}
      </SkeletonReveal>
    </div>
  )
}
