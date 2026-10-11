import { faDiscord } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { GitMerge, GitPullRequest, GitPullRequestClosed, Terminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { agentApi } from '../../api/agent-api'
import { useSessionTerminalProcesses } from '../../lib/sessionTerminalProcesses'
import { toast } from '../ui/toast'

import type { SessionResource } from '../../api/session-resource-types'
import type { ReactNode } from 'react'

const iconClass = 'size-3 shrink-0'

function resourceStyle(resource: SessionResource): { icon: ReactNode; color: string } {
  if (resource.provider === 'linear')
    return {
      icon: <img src="/linear.svg" alt="Linear" className={iconClass} />,
      color: 'session-resource-linear',
    }
  if (resource.provider === 'slack')
    return {
      icon: <img src="/slack.svg" alt="Slack" className={iconClass} />,
      color: 'text-secondary',
    }
  if (resource.provider === 'discord')
    return {
      icon: <FontAwesomeIcon icon={faDiscord} className={`${iconClass} text-[#5865f2]`} />,
      color: 'text-secondary',
    }
  if (resource.state === 'merged')
    return { icon: <GitMerge className={iconClass} />, color: 'session-resource-merged' }
  if (resource.state === 'closed')
    return {
      icon: <GitPullRequestClosed className={iconClass} />,
      color: 'session-resource-closed',
    }

  return { icon: <GitPullRequest className={iconClass} />, color: 'session-resource-open' }
}

/** Resource links belong to their session, including sessions that are not open. */
export function SessionResources({
  resources,
  teamId,
  sessionId,
  titlebar = false,
  onOpen,
  onOpenTab,
}: {
  resources: SessionResource[]
  teamId: string
  sessionId: string
  titlebar?: boolean
  onOpen?: (url: string, external: boolean) => void
  onOpenTab?: (tabId: string) => void
}) {
  const processes = useSessionTerminalProcesses(sessionId)
  const ResourceLabel = titlebar ? 'button' : 'span'

  const [canManage, setCanManage] = useState(false)
  const [removed, setRemoved] = useState<string[]>([])
  const [removing, setRemoving] = useState<string[]>([])

  useEffect(() => {
    let disposed = false

    if (titlebar && resources.length) {
      void agentApi
        .agentGetSessionResources(sessionId, teamId)
        .then((result) => {
          if (!disposed) setCanManage(result.canManage)
        })
        .catch(() => {})
    }

    return () => {
      disposed = true
    }
  }, [sessionId, teamId, resources.length, titlebar])

  async function unlink(resourceId: string) {
    setRemoving((ids) => [...ids, resourceId])
    try {
      await agentApi.agentUnlinkSessionResource(sessionId, teamId, resourceId)
      setRemoved((ids) => [...ids, resourceId])
    } catch (error) {
      toast.apiError('Could not unlink resource', error)
    } finally {
      setRemoving((ids) => ids.filter((id) => id !== resourceId))
    }
  }

  if (!resources.length && !processes.length) return null
  const linked = resources.filter((resource) => !removed.includes(resource.id))

  return (
    <div
      className={
        titlebar
          ? 't-session-heading titlebar-no-drag flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-tertiary'
          : 'flex min-w-0 items-center gap-2 overflow-hidden px-2 pb-2 pl-8 text-[11px] text-tertiary'
      }
      aria-label="Linked resources"
    >
      {linked.map((resource) => {
        const thread = resource.provider === 'slack' || resource.provider === 'discord'
        const { icon, color } = resourceStyle(resource)
        let label = resource.title.split(/\s+/, 1)[0]

        if (resource.provider === 'github') label = `#${String(resource.number)}`
        else if (thread) label = resource.title

        return (
          <span
            key={resource.id}
            className={`inline-flex items-center ${titlebar ? 'session-resource-tag shrink-0 rounded border' : thread ? 'min-w-0' : 'shrink-0'} ${color}`}
          >
            <ResourceLabel
              onPointerDown={(event) => {
                if (titlebar) event.stopPropagation()
              }}
              onClick={(event) => {
                if (!titlebar) return
                event.stopPropagation()
                onOpen?.(resource.url, thread || event.metaKey)
              }}
              key={resource.id}
              className={
                titlebar
                  ? 'inline-flex min-w-0 max-w-24 items-center gap-1 rounded-l px-1.5 py-0.5 transition-colors hover:bg-[var(--sidebar-overlay-hover)] active:bg-[var(--sidebar-overlay-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-current'
                  : 'inline-flex min-w-0 max-w-40 items-center gap-1'
              }
              title={`${resource.repository ?? ''} ${resource.title} · ${resource.state}`}
              aria-label={`${label} · ${resource.state}`}
            >
              <span className="inline-flex shrink-0">{icon}</span>
              <span className="truncate">{label}</span>
            </ResourceLabel>
            {titlebar && canManage && !thread && (
              <button
                type="button"
                aria-label={`Unlink ${label}`}
                title="Unlink resource"
                disabled={removing.includes(resource.id)}
                className="inline-flex shrink-0 self-stretch items-center rounded-r px-1 transition-colors text-tertiary hover:bg-red-500/15 hover:text-red-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-current disabled:opacity-40"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  void unlink(resource.id)
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        )
      })}
      {processes.map(({ tabId, name }) => (
        <ResourceLabel
          key={tabId}
          onPointerDown={(event) => {
            if (titlebar) event.stopPropagation()
          }}
          onClick={(event) => {
            if (!titlebar) return
            event.stopPropagation()
            onOpenTab?.(tabId)
          }}
          className={`inline-flex min-w-0 max-w-40 items-center gap-1 text-secondary ${titlebar ? 'shrink-0 rounded border border-[var(--sidebar-overlay-active)] px-1.5 py-0.5 transition-colors hover:bg-[var(--sidebar-overlay-hover)] active:bg-[var(--sidebar-overlay-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-current' : ''}`}
          title={name}
        >
          <Terminal className="size-3 shrink-0" />
          <span className="truncate">{name}</span>
        </ResourceLabel>
      ))}
    </div>
  )
}
