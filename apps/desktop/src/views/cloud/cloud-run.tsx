import { useCallback, useEffect, useRef, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'
import { useSilentRefresh } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { readCachedResourceList } from '../../lib/resourceListCache'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResetOnKey } from '../useResetOnKey'

import { CloudRunErrorBlock } from './cloud-run-error'
import { ingressLabel } from './cloud-run-format'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { AtlasError } from '../../api'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { GcpCloudRunService } from '../../types'

export function CloudRunServicesView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
  teamId,
  projectId,
  onFixInChat,
}: CommonProps & {
  loader: ResourceListLoader<GcpCloudRunService>
  getRowLink?: (service: GcpCloudRunService) => string
  /** Pair with `onFixInChat`; needed for the IAM self-write probe. */
  teamId?: string
  projectId?: string
  /** Seed the agent chat with a prompt asking it to fix the missing role. */
  onFixInChat?: (prompt: string) => void
}) {
  // This view keeps its bespoke load/error handling (AtlasError + the
  // agent-self-remediation block), so instead of routing through
  // `useResourceList` we add stale-while-revalidate inline: seed from cache for
  // an instant render, let the cache-wrapped `loader` write through on success,
  // and surface a `revalidating` flag so the toolbar refresh button spins.
  const [initialCache] = useState(() => readCachedResourceList<GcpCloudRunService>(loader.cacheKey))
  const [items, setItems] = useState<GcpCloudRunService[]>(() => initialCache?.items ?? [])
  const [loading, setLoading] = useState(() => !initialCache)
  const [revalidating, setRevalidating] = useState(false)
  const [error, setError] = useState<AtlasError | null>(null)
  const [menu, setMenu] = useState<{ service: GcpCloudRunService; x: number; y: number } | null>(
    null,
  )

  useReportLoading(loading || revalidating, onLoading)
  const { pollTick } = useWorkspaceTab()

  // Parent passes `loader` as a fresh arrow on every render — read it through
  // a ref so `load`'s identity is stable and the load effect doesn't refire
  // on every parent re-render (which the onLoading callback can trigger,
  // producing a setError(null) → setError(parsed) flicker loop when the SA
  // has no permission).
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })

  const load = useCallback(() => {
    let cancelled = false
    const cached = readCachedResourceList<GcpCloudRunService>(loaderRef.current.cacheKey)

    if (cached) {
      // Show cached services immediately; revalidate in the background.
      setItems(cached.items)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)
    setRevalidating(true)
    loaderRef
      .current()
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(parseAtlasError(e))
        setLoading(false)
      })
      .finally(() => {
        if (cancelled) return
        setRevalidating(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Pass `load` by reference so its cleanup (`() => { cancelled = true; }`)
  // is returned by the effect and runs when refreshKey/load changes — otherwise
  // an in-flight request from the previous load can land after the next one
  // and stomp its state.
  useEffect(load, [refreshKey, load])
  useSilentRefresh(loader, pollTick, setItems, (msg) => setError(parseAtlasError(new Error(msg))))

  // For agent-fixable errors (API disabled, IAM denied), probe the IAM page's
  // self-capability check to decide whether the agent has the elevated power
  // to self-remediate — if it does, expose a "Fix with Agent" shortcut that
  // seeds the chat prompt. The probe is gated on the error code so we don't
  // waste a call on every load.
  //
  // We use `canWrite` (i.e. `resourcemanager.projects.setIamPolicy`) as the
  // proxy for "agent has elevated power": with IAM write the agent can grant
  // itself `serviceUsageAdmin` and enable the missing API, or grant itself
  // the missing run.* permission directly.
  const agentFixable =
    error?.code === 'cloud_run_permission_denied' || error?.code === 'cloud_run_api_disabled'
  const [agentCanWriteIam, setAgentCanWriteIam] = useState<boolean | null>(null)
  const canProbeIam = !!(agentFixable && teamId && projectId && onFixInChat)

  useResetOnKey(`${String(canProbeIam)}|${String(teamId)}|${String(projectId)}`, () => {
    if (!canProbeIam) setAgentCanWriteIam(null)
  })
  useEffect(() => {
    if (!canProbeIam) return
    let cancelled = false

    api
      .atlasGetGcpIamPermissions(teamId, projectId)
      .then((d) => {
        if (cancelled) return
        setAgentCanWriteIam(d.selfCapabilities.canWrite)
      })
      .catch(() => {
        if (cancelled) return
        setAgentCanWriteIam(false)
      })

    return () => {
      cancelled = true
    }
  }, [canProbeIam, teamId, projectId])

  const fixInChat = useCallback(() => {
    if (!onFixInChat || !error) return
    const d = (error.details ?? {}) as {
      project?: string
      serviceAccountEmail?: string
      permission?: string
      service?: string
      serviceTitle?: string
    }
    const sa = d.serviceAccountEmail ?? 'the bound service account'
    const proj = d.project ?? projectId ?? 'this project'
    let prompt: string

    if (error.code === 'cloud_run_api_disabled') {
      const svcId = d.service ?? 'run.googleapis.com'

      prompt = `GCP project \`${proj}\` has \`${svcId}\` disabled, so Nuphos can't list Cloud Run services. Bound SA: \`${sa}\`. Please enable the API.`
    } else if (d.permission) {
      prompt = `Nuphos-bound GCP SA \`${sa}\` (project \`${proj}\`) is missing the \`${d.permission}\` permission. Please grant it (e.g. via \`roles/run.viewer\`).`
    } else {
      prompt = `Nuphos-bound GCP SA \`${sa}\` (project \`${proj}\`) lacks permission to call the Cloud Run Admin API. Please grant \`roles/run.viewer\`.`
    }
    onFixInChat(prompt)
  }, [onFixInChat, error, projectId])

  const linkActions = useRowLinkActions(getRowLink)

  const filtered = applyFilter(
    items,
    filter,
    (s) => `${s.name} ${s.region} ${s.status} ${s.url ?? ''} ${s.latestReadyRevision ?? ''}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) {
    return (
      <CloudRunErrorBlock
        error={error}
        onRetry={load}
        onFixInChat={agentCanWriteIam ? fixInChat : undefined}
      />
    )
  }

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={linkActions(menu.service)}
          onClose={() => setMenu(null)}
        />
      )}
      <Table<GcpCloudRunService>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.region}/${r.name}`}
        onRowContextMenu={(service, e) => setMenu({ service, x: e.clientX, y: e.clientY })}
        storageKey="gcp.cloud-run-services"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 220,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            width: 110,
            sortAccessor: (r) => r.status,
            render: (r) => <StatusBadge status={r.status} />,
          },
          {
            key: 'region',
            header: 'Region',
            width: 150,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'url',
            header: 'URL',
            width: 280,
            sortAccessor: (r) => r.url ?? '',
            render: (r) =>
              r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] text-zViolet-accent hover:underline truncate block max-w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.url}
                </a>
              ) : (
                <span className="text-tertiary font-mono text-[12px]">—</span>
              ),
          },
          {
            key: 'ingress',
            header: 'Ingress',
            width: 110,
            sortAccessor: (r) => r.ingress ?? '',
            render: (r) => (
              <span className="text-secondary text-[12px]">{ingressLabel(r.ingress)}</span>
            ),
          },
          {
            key: 'revision',
            header: 'Latest Revision',
            width: 200,
            sortAccessor: (r) => r.latestReadyRevision ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">
                {r.latestReadyRevision ?? '—'}
              </span>
            ),
          },
          {
            key: 'age',
            header: 'Age',
            width: 100,
            sortAccessor: (r) => r.updatedAt ?? r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.updatedAt ?? r.createdAt} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
