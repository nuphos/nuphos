import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Age } from '../../components/Age'
import { DetailSidebarTransition } from '../../components/DetailSidebarTransition'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey } from '../../lib/query/tabQuery'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../../lib/workspaceRowLink'

import { htmlToText } from './compliance-helpers'
import { ComplianceTestDetail } from './ComplianceTestDetail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { ComplianceRow } from './compliance-helpers'
import type { CommonProps } from './shared'
import type { SecureframeTest, VantaTest } from '../../types'

async function failingTests(
  teamId: string,
  provider: 'secureframe' | 'vanta',
  integrationId: string,
): Promise<ComplianceRow[]> {
  if (provider === 'secureframe') {
    const tests = await api.atlasListSecureframeTests(teamId, integrationId, true)

    return tests.map((test: SecureframeTest) => ({
      key: test.id,
      name: htmlToText(test.description) || test.id,
      category: '',
      reason: htmlToText(test.failureMessage),
      remediation: htmlToText(test.remediation),
      status: test.healthStatus || 'fail',
      lastRun: null,
    }))
  }
  const tests = await api.atlasListVantaTests(teamId, integrationId, {
    status: 'NEEDS_ATTENTION',
  })

  return tests.map((test: VantaTest) => ({
    key: test.id,
    name: htmlToText(test.name) || test.id,
    category: test.category || '',
    reason: htmlToText(test.failureDescription),
    remediation: htmlToText(test.remediationDescription),
    status: test.status || 'NEEDS_ATTENTION',
    lastRun: test.lastTestRunDate,
  }))
}

/**
 * Failed compliance tests for a bound Secureframe or Vanta integration. Both
 * providers' `/tests` proxies default to the failing / needs-attention tests —
 * the compliance issues to resolve — so this view is a flat list of what's red.
 */
export function ComplianceIntegrationView({
  teamId,
  provider,
  integrationId,
  found,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  teamId: string
  provider: 'secureframe' | 'vanta'
  integrationId: string
  /** False when the integration id no longer matches a bound account. */
  found: boolean
}) {
  const query = useQuery({
    queryKey: queryKeys.complianceTests(teamId, provider, integrationId),
    queryFn: () => failingTests(teamId, provider, integrationId),
    enabled: found,
  })
  const rows = query.data ?? []
  const error = query.error ? parseAtlasError(query.error).message : null
  const loading = found && query.isPending

  useRefreshKey(
    { isPending: loading, refetch: () => (found ? query.refetch() : Promise.resolve()) },
    refreshKey,
    onLoading,
  )

  const filtered = applyFilter(
    rows,
    filter,
    (row) => `${row.name} ${row.category} ${row.reason} ${row.status}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const providerLabel = provider === 'vanta' ? 'Vanta' : 'Secureframe'

  const { linkForRow, openInChat } = useWorkspaceRowLink()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const linkFor = useCallback(
    (row: ComplianceRow) =>
      linkForRow({ target: { kind: 'test', namespace: null, name: row.key } }),
    [linkForRow],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(linkFor)

  const selectedRow = useMemo(
    () => filtered.find((row) => row.key === selectedId) ?? null,
    [filtered, selectedId],
  )

  if (!found) {
    return (
      <ErrorBlock message={t('{provider} integration not found.', { provider: providerLabel })} />
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      {menu}
      <div
        className={`flex flex-col min-h-0 flex-1 min-w-0${selectedRow ? ' border-r border-line-control/60' : ''}`}
      >
        {error && (
          <div className="px-6 py-2 border-b border-error/30 bg-error/10 text-[12.5px] text-error">
            {error}
          </div>
        )}
        <Table<ComplianceRow>
          loading={loading}
          rows={filtered}
          rowKey={(row) => row.key}
          onPrimaryAction={(row) => setSelectedId(row.key === selectedId ? null : row.key)}
          onRowContextMenu={(row, event) =>
            onRowContextMenu(row, { clientX: event.clientX, clientY: event.clientY })
          }
          empty={
            loading
              ? t('Loading {provider} tests…', { provider: providerLabel })
              : filter
                ? t('No failing {provider} tests match the current filter.', {
                    provider: providerLabel,
                  })
                : t('No failing {provider} tests — compliance is all green.', {
                    provider: providerLabel,
                  })
          }
          storageKey={`compliance.${provider}.tests`}
          columns={[
            {
              key: 'name',
              header: t('Test'),
              width: 320,
              sortAccessor: (row) => row.name,
              render: (row) => <span className="text-main font-medium truncate">{row.name}</span>,
            },
            ...(provider === 'vanta'
              ? [
                  {
                    key: 'category',
                    header: t('Category'),
                    width: 180,
                    sortAccessor: (row: ComplianceRow) => row.category,
                    render: (row: ComplianceRow) => (
                      <span className="text-secondary truncate">{row.category || '-'}</span>
                    ),
                  },
                ]
              : []),
            {
              key: 'reason',
              header: t('Why it is failing'),
              width: 420,
              sortAccessor: (row) => row.reason,
              render: (row) => (
                <span className="text-secondary truncate" title={row.remediation || undefined}>
                  {row.reason || '-'}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('Status'),
              width: 150,
              sortAccessor: (row) => row.status,
              render: (row) => <StatusBadge status={row.status} />,
            },
            ...(provider === 'vanta'
              ? [
                  {
                    key: 'lastRun',
                    header: t('Last run'),
                    width: 160,
                    sortAccessor: (row: ComplianceRow) => row.lastRun || '',
                    render: (row: ComplianceRow) =>
                      row.lastRun ? (
                        <Age value={row.lastRun} />
                      ) : (
                        <span className="text-tertiary">-</span>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {selectedRow && (
        <DetailSidebarTransition
          onClose={() => setSelectedId(null)}
          className="flex-shrink-0 w-[44%] min-w-[380px] max-w-[680px] flex flex-col bg-surface-canvas min-h-0 overflow-hidden"
        >
          {(requestClose) => (
            <ComplianceTestDetail
              row={selectedRow}
              provider={provider}
              onOpenInChat={() => openInChat(linkFor(selectedRow))}
              onClose={requestClose}
            />
          )}
        </DetailSidebarTransition>
      )}
    </div>
  )
}
