import { faDiscord } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { GitMerge, GitPullRequest, GitPullRequestClosed, Terminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { agentApi } from '../../api/agent-api'
import { useSessionTerminalProcesses } from '../../lib/sessionTerminalProcesses'
import { ResourcePreview } from '../ui/resource-preview'
import { toast } from '../ui/toast'

import type { SessionResource } from '../../api/session-resource-types'
import type { ReactNode } from 'react'

const iconClass = 'size-3 shrink-0'

const ring = <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />

/** A filled disc with the glyph cut out, as Linear draws Done, Canceled and Triage. */
function cutout(glyph: string) {
  return (
    <>
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d={glyph}
        fill="none"
        stroke="rgb(var(--color-background-base))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  )
}

/**
 * Linear's own workflow-state glyphs. Each type gets one color, shared by the
 * icon and the tag label, so the tag reads like the issue row in Linear.
 */
const linearStates: Partial<Record<string, { glyph: ReactNode; color: string }>> = {
  triage: { glyph: cutout('M4 5.5h6l-1.5-1.5M10 8.5H4l1.5 1.5'), color: 'session-resource-triage' },
  backlog: {
    glyph: (
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="1.4 1.74"
      />
    ),
    color: 'text-tertiary',
  },
  unstarted: { glyph: ring, color: 'text-tertiary' },
  started: {
    glyph: (
      <>
        {ring}
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </>
    ),
    color: 'session-resource-started',
  },
  completed: { glyph: cutout('M4.5 7.2l1.7 1.7 3.4-3.6'), color: 'session-resource-linear' },
  canceled: { glyph: cutout('M5 5l4 4M9 5l-4 4'), color: 'text-tertiary' },
  duplicate: { glyph: cutout('M5 5l4 4M9 5l-4 4'), color: 'text-tertiary' },
}

function resourceStyle(resource: SessionResource): { icon: ReactNode; color: string } {
  if (resource.provider === 'linear') {
    const state = linearStates[resource.stateType ?? '']

    // Links made before state types were stored keep the logo until Linear reports a change.
    if (!state)
      return {
        icon: <img src="/linear.svg" alt="Linear" className={iconClass} />,
        color: 'session-resource-linear',
      }

    return {
      icon: (
        <svg viewBox="0 0 14 14" className={iconClass} aria-hidden>
          {state.glyph}
        </svg>
      ),
      color: state.color,
    }
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

        const unlinkButton =
          titlebar && canManage ? (
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
              {resource.provider === 'github' && <span>Unlink</span>}
            </button>
          ) : null

        const badge = (
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
              title={
                resource.provider === 'github' ? undefined : `${resource.title} · ${resource.state}`
              }
              aria-label={`${label} · ${resource.state}`}
            >
              <span className="inline-flex shrink-0">{icon}</span>
              <span className="truncate">{label}</span>
            </ResourceLabel>
            {resource.provider !== 'github' && unlinkButton}
          </span>
        )

        return resource.provider === 'github' ? (
          <ResourcePreview
            key={resource.id}
            actionable={titlebar}
            actions={unlinkButton}
            repository={resource.repository ?? 'GitHub'}
            identifier={label}
            title={resource.title}
            state={resource.state}
          >
            {badge}
          </ResourcePreview>
        ) : (
          badge
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
