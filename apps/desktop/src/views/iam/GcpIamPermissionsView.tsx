import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'

import { BindingAccessSection } from '../../components/BindingAccess'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { useRefreshKey, useTabPollMs } from '../../lib/query/tabQuery'

import {
  DetailSidebarCloseButton,
  DetailSidebarLoading,
  LoadedDetailContentReveal,
} from './detailPane'
import { GcpBindingCard } from './GcpBindingCard'
import { gcpPermissionsQuery } from './iamQueries'
import {
  BindingWarnings,
  EffectivePermissions,
  EmptyHint,
  RetiredBindingNotice,
  ProviderSummaryCard,
  Warnings,
} from './permissionCards'

import type { CommonProps } from './common'
import type { BindingAccess } from '../../types'

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
  const query = useQuery({
    ...gcpPermissionsQuery(teamId, projectId, serviceAccountId),
    refetchInterval: useTabPollMs(),
  })
  const visibleData = query.data ?? null
  const error = query.error?.message ?? null
  const loading = query.isPending

  useRefreshKey(query, refreshKey, onLoading)

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <DetailSidebarCloseButton onClose={onClose} />
      {visibleData ? (
        <ProviderSummaryCard
          provider="gcp"
          title={visibleData.serviceAccountEmail}
          subtitle={visibleData.projectId}
          rows={[
            { label: t('Project ID'), value: visibleData.projectId, mono: true },
            visibleData.bindings.length > 0 || visibleData.effectivePermissions === null
              ? {
                  label: t('Roles granted'),
                  value: String(visibleData.bindings.length),
                }
              : {
                  label: t('Effective permissions'),
                  value: t('{n} probed', { n: visibleData.effectivePermissions.length }),
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
                icon={<ShieldCheck className="w-4 h-4 text-primary" strokeWidth={1.8} />}
                title={t('Granted roles')}
                hint={
                  visibleData.bindings.length > 0
                    ? visibleData.bindings.length === 1
                      ? t('{n} binding includes this service account', {
                          n: visibleData.bindings.length,
                        })
                      : t('{n} bindings include this service account', {
                          n: visibleData.bindings.length,
                        })
                    : visibleData.effectivePermissions
                      ? t("Couldn't list bindings — showing effective permissions instead")
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
                <EmptyHint
                  message={t(
                    'No IAM bindings include this service account on this project. Nuphos can impersonate the SA but every API call will be denied. Grant the connector roles (typically roles/container.viewer, roles/compute.viewer, etc.) and refresh.',
                  )}
                />
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
              <section className="px-6 py-4 border-t border-line-control/60">
                <EmptyHint
                  message={t('Open a specific service account to manage who can use it.')}
                />
              </section>
            )}
          </LoadedDetailContentReveal>
        )}
      </div>
    </div>
  )
}
