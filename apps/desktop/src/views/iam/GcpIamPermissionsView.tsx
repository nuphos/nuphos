import { ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { BindingAccessSection } from '../../components/BindingAccess'
import { SectionHeader } from '../../components/SectionHeader'
import { useReportLoading } from '../../components/useReportLoading'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResetOnKey } from '../useResetOnKey'

import {
  DetailSidebarCloseButton,
  DetailSidebarLoading,
  LoadedDetailContentReveal,
} from './detailPane'
import { GcpBindingCard } from './GcpBindingCard'
import {
  BindingWarnings,
  EffectivePermissions,
  EmptyHint,
  RetiredBindingNotice,
  ProviderSummaryCard,
  Warnings,
} from './permissionCards'

import type { CommonProps } from './common'
import type { BindingAccess, GcpIamPermissions } from '../../types'

export function GcpIamPermissionsView({
  teamId,
  projectId,
  serviceAccountId,
  refreshKey,
  isRetiredBinding = false,
  onLoading,
  onAccessChanged,
  onClose,
}: CommonProps & {
  projectId: string
  serviceAccountId?: string
  /** Whether the service account being viewed is itself a permission-admin SA. */
  isRetiredBinding?: boolean
  onAccessChanged?: (access: BindingAccess) => void
  onClose?: () => void
}) {
  const identityKey = `gcp:${teamId}:${projectId}:${serviceAccountId ?? ''}`
  const [data, setData] = useState<GcpIamPermissions | null>(null)
  const [dataKey, setDataKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reqRef = useRef(0)

  useReportLoading(loading, onLoading)

  useResetOnKey(`${identityKey}|${String(refreshKey)}`, () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    const req = ++reqRef.current

    api
      .atlasGetGcpIamPermissions(teamId, projectId, serviceAccountId)
      .then((res) => {
        if (req !== reqRef.current) return
        setData(res)
        setDataKey(identityKey)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })
  }, [teamId, projectId, serviceAccountId, refreshKey, identityKey])

  const { pollTick } = useWorkspaceTab()
  const silentReload = useCallback(() => {
    // Snapshot the current request id instead of incrementing it: a poll
    // must NOT invalidate an in-flight foreground load (which is what
    // tracks `loading`). If a foreground load lands between this snapshot
    // and the response, `req !== reqRef.current` and we drop the stale
    // background result.
    const req = reqRef.current

    api
      .atlasGetGcpIamPermissions(teamId, projectId, serviceAccountId)
      .then((res) => {
        if (req !== reqRef.current) return
        setData(res)
        setDataKey(identityKey)
        setError(null)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId, projectId, serviceAccountId, identityKey])

  useSilentTick(silentReload, pollTick)

  const visibleData = dataKey === identityKey ? data : null

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <DetailSidebarCloseButton onClose={onClose} />
      {visibleData ? (
        <ProviderSummaryCard
          provider="gcp"
          title={visibleData.serviceAccountEmail}
          subtitle={visibleData.projectId}
          rows={[
            { label: 'Project ID', value: visibleData.projectId, mono: true },
            visibleData.bindings.length > 0 || visibleData.effectivePermissions === null
              ? {
                  label: 'Roles granted',
                  value: String(visibleData.bindings.length),
                }
              : {
                  label: 'Effective permissions',
                  value: `${String(visibleData.effectivePermissions.length)} probed`,
                },
          ]}
          pinned
        />
      ) : null}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && !visibleData && <DetailSidebarLoading />}
        {error && (
          <div className="m-4 p-3 rounded-md border border-error/40 bg-error/10 text-[12.5px] text-error">
            {error}
          </div>
        )}
        {visibleData && (
          <LoadedDetailContentReveal
            revealKey={`gcp:${visibleData.projectId}:${serviceAccountId ?? visibleData.serviceAccountEmail}`}
          >
            {isRetiredBinding && <RetiredBindingNotice principal="service account" />}
            <Warnings warnings={visibleData.warnings} />
            <section className="px-6 py-4">
              <SectionHeader
                icon={<ShieldCheck className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />}
                title="Granted roles"
                hint={
                  visibleData.bindings.length > 0
                    ? `${String(visibleData.bindings.length)} bindings include this service account`
                    : visibleData.effectivePermissions
                      ? "Couldn't list bindings — showing effective permissions instead"
                      : undefined
                }
              />
              <BindingWarnings warnings={visibleData.bindingWarnings} />
              {visibleData.bindings.length > 0 ? (
                <div className="space-y-2">
                  {visibleData.bindings.map((b, idx) => (
                    <GcpBindingCard
                      key={`${b.role}-${b.member}-${String(idx)}`}
                      role={b.role}
                      member={b.member}
                      condition={b.condition}
                      details={visibleData.roles.find((r) => r.name === b.role)}
                    />
                  ))}
                </div>
              ) : visibleData.effectivePermissions ? (
                <EffectivePermissions
                  permissions={visibleData.effectivePermissions}
                  serviceAccountEmail={visibleData.serviceAccountEmail}
                />
              ) : (
                <EmptyHint message="No IAM bindings include this service account on this project. Nuphos can impersonate the SA but every API call will be denied. Grant the connector roles (typically roles/container.viewer, roles/compute.viewer, etc.) and refresh." />
              )}
            </section>
            {serviceAccountId ? (
              <BindingAccessSection
                teamId={teamId}
                provider="gcp"
                resourceId={projectId}
                secondaryId={serviceAccountId}
                principal={visibleData.serviceAccountEmail}
                refreshKey={refreshKey}
                onAccessChanged={onAccessChanged}
              />
            ) : (
              <section className="px-6 py-4 border-t border-zGray-800/60">
                <EmptyHint message="Open a specific service account to manage who can use it." />
              </section>
            )}
          </LoadedDetailContentReveal>
        )}
      </div>
    </div>
  )
}
