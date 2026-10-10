import { GitMerge, GitPullRequest, GitPullRequestClosed, Link2, Terminal, X } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'

import { agentApi } from '../../api/agent-api'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { useSessionTerminalProcesses } from '../../lib/sessionTerminalProcesses'
import { toast } from '../ui/toast'

import { ResourceOpenContext } from './resource-open-context'

import type { SessionResource } from '../../api/session-resource-types'

/** Resource links belong to their session, including sessions that are not open. */
export function SessionResources({
  resources,
  teamId,
  sessionId,
  titlebar = false,
}: {
  resources: SessionResource[]
  teamId: string
  sessionId: string
  titlebar?: boolean
}) {
  const processes = useSessionTerminalProcesses(sessionId)
  const open = useContext(ResourceOpenContext)
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
  const visible = titlebar ? linked : linked.slice(0, 2)

  return (
    <div
      className={
        titlebar
          ? 't-session-heading titlebar-no-drag flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-tertiary'
          : 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-2 pl-8 text-[11px] text-tertiary'
      }
      aria-label="Linked resources"
    >
      {visible.map((resource) => {
        let Icon = Link2
        let color = 'session-resource-linear'

        if (resource.provider === 'github') {
          Icon = GitPullRequest
          color = 'session-resource-open'
          if (resource.state === 'merged') {
            Icon = GitMerge
            color = 'session-resource-merged'
          } else if (resource.state === 'closed') {
            Icon = GitPullRequestClosed
            color = 'session-resource-closed'
          }
        }
        const label =
          resource.provider === 'github'
            ? `#${String(resource.number)}`
            : resource.title.split(/\s+/, 1)[0]

        return (
          <span
            key={resource.id}
            className={`inline-flex shrink-0 items-center ${titlebar ? 'session-resource-tag rounded border' : ''} ${color}`}
          >
            <ResourceLabel
              onPointerDown={(event) => {
                if (titlebar) event.stopPropagation()
              }}
              onClick={(event) => {
                if (!titlebar) return
                event.stopPropagation()
                const href = pageLocationForNavigation(
                  emptyNavigation({ kind: 'team', teamId }, 'team.browser', {
                    browserUrl: resource.url,
                  }),
                ).href

                open?.(href, label, true)
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
              <span className="inline-flex shrink-0">
                {resource.provider === 'linear' ? (
                  <img src="/linear.svg" alt="Linear" className="size-3 shrink-0" />
                ) : (
                  <Icon className="size-3 shrink-0" />
                )}
              </span>
              <span className="truncate">{label}</span>
            </ResourceLabel>
            {titlebar && canManage && (
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
      {processes.map((name) => (
        <span
          key={name}
          className={`inline-flex min-w-0 max-w-40 items-center gap-1 text-secondary ${titlebar ? 'shrink-0 rounded border border-[var(--sidebar-overlay-active)] px-1.5 py-0.5' : ''}`}
          title={name}
        >
          <Terminal className="size-3 shrink-0" />
          <span className="truncate">{name}</span>
        </span>
      ))}
    </div>
  )
}
