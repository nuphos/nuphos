import { BarChart3, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { toast } from '../../components/ui/toast'
import { POSTHOG_RECONNECT_REQUIRED } from '../../types/posthog'
import { PosthogProjectChecklist } from '../PosthogProjectChecklist'
import { useResetOnKey } from '../useResetOnKey'

import { PosthogPermissionsSection } from './PosthogPermissionsSection'
import { PosthogReconnectPrompt } from './PosthogReconnect'

import type { PosthogIntegration, PosthogProject } from '../../types'

type Editing = { available: PosthogProject[]; selectedIds: number[] } | null

export function PosthogConnectorGuide({
  teamId,
  connectorId,
  refreshKey,
  onChanged,
}: {
  teamId: string
  connectorId: string
  refreshKey: number
  onChanged: () => void
}) {
  const [integration, setIntegration] = useState<PosthogIntegration | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const projects = integration?.projects ?? null
  const [editing, setEditing] = useState<Editing>(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => {
    setReloadKey((key) => key + 1)
    onChanged()
  }

  useResetOnKey(`${teamId}|${connectorId}|${String(refreshKey)}|${String(reloadKey)}`, () => {
    setIntegration(null)
    setNeedsReconnect(false)
    setEditing(null)
  })
  useEffect(() => {
    let cancelled = false

    api
      .atlasListPosthogIntegrations(teamId)
      .then((rows) => {
        if (cancelled) return
        const row = rows.find((item) => item.id === connectorId) ?? null

        setIntegration(row)
        setNeedsReconnect(row?.status === 'reconnect_required')
      })
      .catch((cause: unknown) => {
        if (!cancelled) toast.apiError('Could not load PostHog projects', cause)
      })

    return () => {
      cancelled = true
    }
  }, [teamId, connectorId, refreshKey, reloadKey])

  async function startEditing() {
    setBusy(true)
    try {
      const available = await api.atlasListPosthogAvailableProjects(teamId, connectorId)

      setEditing({ available, selectedIds: (projects ?? []).map((project) => project.id) })
    } catch (cause) {
      if (parseAtlasError(cause).code === POSTHOG_RECONNECT_REQUIRED) setNeedsReconnect(true)
      else toast.apiError('Could not list PostHog projects', cause)
    } finally {
      setBusy(false)
    }
  }

  async function saveProjects() {
    if (!editing) return
    if (editing.selectedIds.length === 0) return toast.error('Select at least one project.')
    setBusy(true)
    try {
      const updated = await api.atlasUpdatePosthogProjects(teamId, connectorId, editing.selectedIds)

      setIntegration(updated)
      setEditing(null)
      onChanged()
    } catch (cause) {
      if (parseAtlasError(cause).code === POSTHOG_RECONNECT_REQUIRED) {
        setEditing(null)
        setNeedsReconnect(true)
      } else {
        toast.apiError('Could not update PostHog projects', cause)
      }
    } finally {
      setBusy(false)
    }
  }

  if (integration && needsReconnect) {
    return (
      <section className="mt-6">
        <PosthogReconnectPrompt teamId={teamId} integration={integration} onReconnected={reload} />
      </section>
    )
  }

  return (
    <>
      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[12.5px] font-medium text-main">Projects the agent may query</h3>
          {!editing && (
            <button
              type="button"
              onClick={() => void startEditing()}
              disabled={busy || projects === null}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-secondary hover:bg-zGray-850 hover:text-main disabled:opacity-50"
            >
              <Pencil className="h-3 w-3" strokeWidth={1.9} />
              Edit projects
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <PosthogProjectChecklist
              projects={editing.available}
              selectedIds={editing.selectedIds}
              onChange={(selectedIds) => setEditing({ ...editing, selectedIds })}
              disabled={busy}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12px] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveProjects()}
                disabled={busy || editing.selectedIds.length === 0}
                className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12px] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <ProjectList projects={projects} />
        )}
      </section>
      {integration && (
        <PosthogPermissionsSection teamId={teamId} integration={integration} onChanged={reload} />
      )}
    </>
  )
}

function ProjectList({ projects }: { projects: PosthogProject[] | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zGray-800">
      {projects === null && (
        <div className="px-4 py-4 text-[12px] text-tertiary">Loading projects…</div>
      )}
      {projects?.map((project, index) => (
        <div
          key={project.id}
          className={`flex items-center gap-3 px-4 py-3 ${
            index > 0 ? 'border-t border-zGray-800/60' : ''
          }`}
        >
          <BarChart3 className="h-4 w-4 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-main">{project.name}</div>
            <div className="truncate text-[10.5px] text-tertiary">
              {project.organizationName ?? project.organizationId} · ID {project.id}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
