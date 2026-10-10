import { GitPullRequest, Link2, Unlink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { SIDEBAR_GROUP_TITLE_CLASS } from '../SidebarNavItem'

import type { SessionResourcesResponse } from '../../api/session-resource-types'

export function SessionResources({
  teamId,
  sessionId,
}: {
  teamId: string
  sessionId: string | null
}) {
  if (!teamId || !sessionId) return null

  return <LinkedResources key={`${teamId}:${sessionId}`} teamId={teamId} sessionId={sessionId} />
}

/** Remount on team/session changes so a previous conversation never flashes here. */
function LinkedResources({ teamId, sessionId }: { teamId: string; sessionId: string }) {
  const [data, setData] = useState<SessionResourcesResponse>({ resources: [], canManage: false })
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await api.agentGetSessionResources(sessionId, teamId)

        if (!cancelled) {
          setData(result)
          setError('')
        }
      } catch {
        if (!cancelled) {
          setData({ resources: [], canManage: false })
          setError('Unable to load linked resources')
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), 10_000)
      }
    }

    void refresh()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId, teamId])

  async function unlink(id: string) {
    setRemoving(id)
    try {
      await api.agentUnlinkSessionResource(sessionId, teamId, id)
      setData((current) => ({
        ...current,
        resources: current.resources.filter((resource) => resource.id !== id),
      }))
      setError('')
    } catch {
      setError('Unable to unlink resource')
    } finally {
      setRemoving(null)
    }
  }

  if (!data.resources.length && !error) return null

  return (
    <section className="mb-3" aria-label="Linked resources">
      <div className={SIDEBAR_GROUP_TITLE_CLASS}>Linked resources</div>
      {data.resources.map((resource) => {
        const Icon = resource.provider === 'github' ? GitPullRequest : Link2
        const label =
          resource.provider === 'github'
            ? `${resource.repository} #${resource.number}`
            : resource.title

        return (
          <div
            key={resource.id}
            className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zGray-800/40"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
              title={`${resource.title} · ${resource.state}`}
              onClick={() => void api.appOpenExternal(resource.url)}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="max-w-16 truncate text-secondary">{resource.state}</span>
            </button>
            {data.canManage && (
              <button
                type="button"
                disabled={removing !== null}
                className="shrink-0 text-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Unlink ${label}`}
                title="Unlink and stop future notifications"
                onClick={() => void unlink(resource.id)}
              >
                <Unlink className="h-3 w-3" />
              </button>
            )}
          </div>
        )
      })}
      {error && (
        <p role="status" className="px-2 text-xs text-secondary">
          {error}
        </p>
      )}
    </section>
  )
}
