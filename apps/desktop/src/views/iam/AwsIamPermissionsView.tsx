import { KeyRound, ShieldCheck } from 'lucide-react'
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
import { EmptyHint, RetiredBindingNotice, ProviderSummaryCard, Warnings } from './permissionCards'
import { PolicyCard } from './PolicyCard'

import type { CommonProps } from './common'
import type { AwsIamPermissions, BindingAccess } from '../../types'

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
  const identityKey = `aws:${teamId}:${accountId}:${roleId ?? ''}`
  const [data, setData] = useState<AwsIamPermissions | null>(null)
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
      .atlasGetAwsIamPermissions(teamId, accountId, roleId)
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
  }, [teamId, accountId, roleId, refreshKey, identityKey])

  const { pollTick } = useWorkspaceTab()
  const silentReload = useCallback(() => {
    // Snapshot the current request id instead of incrementing it: a poll
    // must NOT invalidate an in-flight foreground load (which is what
    // tracks `loading`). If a foreground load lands between this snapshot
    // and the response, `req !== reqRef.current` and we drop the stale
    // background result.
    const req = reqRef.current

    api
      .atlasGetAwsIamPermissions(teamId, accountId, roleId)
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
  }, [teamId, accountId, roleId, identityKey])

  useSilentTick(silentReload, pollTick)

  const visibleData = dataKey === identityKey ? data : null

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <DetailSidebarCloseButton onClose={onClose} />
      {visibleData ? (
        <ProviderSummaryCard
          provider="aws"
          title={visibleData.roleName}
          subtitle={visibleData.roleArn}
          rows={[
            { label: 'Account ID', value: visibleData.accountId, mono: true },
            {
              label: 'Caller identity',
              value: visibleData.callerArn ?? '—',
              mono: true,
            },
            {
              label: 'Policies attached',
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
            <section className="px-6 py-4 border-t border-zGray-800/60">
              <SectionHeader
                icon={<ShieldCheck className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />}
                title="Granted policies"
                hint={`${String(visibleData.policies.length)} policies on this role`}
              />
              {visibleData.policies.length === 0 ? (
                <EmptyHint message="No IAM policies attached to this role — Nuphos can assume the role but every operation will be denied. Attach a permissions policy (e.g. ReadOnlyAccess) to the role in the AWS IAM console." />
              ) : (
                <div className="border-y border-zGray-800/60">
                  {visibleData.policies.map((p) => (
                    <PolicyCard key={`${p.kind}:${p.arn ?? p.name}`} policy={p} />
                  ))}
                </div>
              )}
            </section>
            {visibleData.trustPolicySummary && (
              <section className="px-6 py-4 border-t border-zGray-800/60">
                <SectionHeader
                  icon={<KeyRound className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />}
                  title="Trust policy"
                  hint="Who is allowed to assume this role"
                />
                <pre className="mt-2 border-y border-zGray-850 bg-zGray-950 py-3 text-[11.5px] font-mono text-secondary overflow-x-auto whitespace-pre-wrap break-words">
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
              <section className="px-6 py-4 border-t border-zGray-800/60">
                <EmptyHint message="Open a specific role to manage who can use it." />
              </section>
            )}
          </LoadedDetailContentReveal>
        )}
      </div>
    </div>
  )
}
