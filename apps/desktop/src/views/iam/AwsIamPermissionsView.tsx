import { useQuery } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'

import { api } from '../../api'
import { BindingAccessSection } from '../../components/BindingAccess'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey, useTabPollMs } from '../../lib/query/tabQuery'

import {
  DetailSidebarCloseButton,
  DetailSidebarLoading,
  LoadedDetailContentReveal,
} from './detailPane'
import { EmptyHint, RetiredBindingNotice, ProviderSummaryCard, Warnings } from './permissionCards'
import { PolicyCard } from './PolicyCard'

import type { CommonProps } from './common'
import type { BindingAccess } from '../../types'

export function AwsIamPermissionsView({
  teamId,
  accountId,
  roleId,
  roleArn,
  refreshKey,
  isRetiredBinding = false,
  onLoading,
  onAccessChanged,
  onClose,
}: CommonProps & {
  accountId: string
  roleId?: string
  roleArn?: string
  /** Whether the role being viewed is itself a permission-admin role. */
  isRetiredBinding?: boolean
  onAccessChanged?: (access: BindingAccess) => void
  onClose?: () => void
}) {
  const query = useQuery({
    queryKey: queryKeys.iamPermissions(teamId, 'aws', accountId, roleId),
    queryFn: () => api.atlasGetAwsIamPermissions(teamId, accountId, roleId),
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
          provider="aws"
          title={visibleData.roleName}
          subtitle={visibleData.roleArn}
          rows={[
            { label: t('Account ID'), value: visibleData.accountId, mono: true },
            {
              label: t('Caller identity'),
              value: visibleData.callerArn ?? '—',
              mono: true,
            },
            {
              label: t('Policies attached'),
              value: String(visibleData.policies.length),
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
            revealKey={`aws:${visibleData.accountId}:${roleId ?? visibleData.roleArn}`}
          >
            {isRetiredBinding && <RetiredBindingNotice principal="role" />}
            <Warnings warnings={visibleData.warnings} />
            <section className="px-6 py-4 border-t border-line-control/60">
              <SectionHeader
                icon={<ShieldCheck className="w-4 h-4 text-primary" strokeWidth={1.8} />}
                title={t('Granted policies')}
                hint={
                  visibleData.policies.length === 1
                    ? t('{n} policy on this role', { n: visibleData.policies.length })
                    : t('{n} policies on this role', { n: visibleData.policies.length })
                }
              />
              {visibleData.policies.length === 0 ? (
                <EmptyHint
                  message={t(
                    'No IAM policies attached to this role — Nuphos can assume the role but every operation will be denied. Attach a permissions policy (e.g. ReadOnlyAccess) to the role in the AWS IAM console.',
                  )}
                />
              ) : (
                <div className="border-y border-line-control/60">
                  {visibleData.policies.map((p) => (
                    <PolicyCard key={`${p.kind}:${p.arn ?? p.name}`} policy={p} />
                  ))}
                </div>
              )}
            </section>
            {visibleData.trustPolicySummary && (
              <section className="px-6 py-4 border-t border-line-control/60">
                <SectionHeader
                  icon={<KeyRound className="w-4 h-4 text-primary" strokeWidth={1.8} />}
                  title={t('Trust policy')}
                  hint={t('Who is allowed to assume this role')}
                />
                <pre className="mt-2 border-y border-line-control bg-surface-canvas py-3 text-[11.5px] font-mono text-secondary overflow-x-auto whitespace-pre-wrap break-words">
                  {visibleData.trustPolicySummary}
                </pre>
              </section>
            )}
            {roleId ? (
              <BindingAccessSection
                teamId={teamId}
                provider="aws"
                resourceId={accountId}
                secondaryId={roleId}
                principal={visibleData.roleArn || roleArn || roleId}
                refreshKey={refreshKey}
                onAccessChanged={onAccessChanged}
              />
            ) : (
              <section className="px-6 py-4 border-t border-line-control/60">
                <EmptyHint message={t('Open a specific role to manage who can use it.')} />
              </section>
            )}
          </LoadedDetailContentReveal>
        )}
      </div>
    </div>
  )
}
