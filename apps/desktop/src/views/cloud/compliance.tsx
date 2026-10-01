import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Age } from '../../components/Age'
import { DetailSidebarTransition } from '../../components/DetailSidebarTransition'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../../lib/workspaceRowLink'
import { useResetOnKey } from '../useResetOnKey'

import { htmlToText } from './compliance-helpers'
import { ComplianceTestDetail } from './ComplianceTestDetail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { ComplianceRow } from './compliance-helpers'
import type { CommonProps } from './shared'
import type { SecureframeTest, VantaTest } from '../../types'

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
  const [rows, setRows] = useState<ComplianceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  // The mount fetch is already in flight, so seed `loading` the way the reset
  // below would have; it only runs for later integration/refresh changes.
  const [loading, setLoading] = useState(found)

  useResetOnKey(
    `${teamId}|${provider}|${integrationId}|${String(found)}|${String(refreshKey)}`,
    () => {
      setRows([])
      setError(null)
      setLoading(found)
    },
  )
  useEffect(() => {
    if (!found) {
      onLoading?.(false)

      return
    }
    let cancelled = false

    onLoading?.(true)
    const load = async (): Promise<ComplianceRow[]> => {
      if (provider === 'secureframe') {
        const tests = await api.atlasListSecureframeTests(teamId, integrationId, true)

        return tests.map((t: SecureframeTest) => ({
          key: t.id,
          name: htmlToText(t.description) || t.id,
          category: '',
          reason: htmlToText(t.failureMessage),
          remediation: htmlToText(t.remediation),
          status: t.healthStatus || 'fail',
          lastRun: null,
        }))
      }
      const tests = await api.atlasListVantaTests(teamId, integrationId, {
        status: 'NEEDS_ATTENTION',
      })

      return tests.map((t: VantaTest) => ({
        key: t.id,
        name: htmlToText(t.name) || t.id,
        category: t.category || '',
        reason: htmlToText(t.failureDescription),
        remediation: htmlToText(t.remediationDescription),
        status: t.status || 'NEEDS_ATTENTION',
        lastRun: t.lastTestRunDate,
      }))
    }

    load()
      .then((next) => {
        if (!cancelled) setRows(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(parseAtlasError(err).message)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          onLoading?.(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [teamId, provider, integrationId, found, refreshKey, onLoading])

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
    return <ErrorBlock message={`${providerLabel} integration not found.`} />
  }

  return (
    <div className="flex-1 flex min-h-0">
      {menu}
      <div
        className={`flex flex-col min-h-0 flex-1 min-w-0${selectedRow ? ' border-r border-zGray-800/60' : ''}`}
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
              ? `Loading ${providerLabel} tests...`
              : filter
                ? `No failing ${providerLabel} tests match the current filter.`
                : `No failing ${providerLabel} tests — compliance is all green.`
          }
          storageKey={`compliance.${provider}.tests`}
          columns={[
            {
              key: 'name',
              header: 'Test',
              width: 320,
              sortAccessor: (row) => row.name,
              render: (row) => <span className="text-main font-medium truncate">{row.name}</span>,
            },
            ...(provider === 'vanta'
              ? [
                  {
                    key: 'category',
                    header: 'Category',
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
              header: 'Why it is failing',
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
              header: 'Status',
              width: 150,
              sortAccessor: (row) => row.status,
              render: (row) => <StatusBadge status={row.status} />,
            },
            ...(provider === 'vanta'
              ? [
                  {
                    key: 'lastRun',
                    header: 'Last run',
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
          className="flex-shrink-0 w-[44%] min-w-[380px] max-w-[680px] flex flex-col bg-zGray-950 min-h-0 overflow-hidden"
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
