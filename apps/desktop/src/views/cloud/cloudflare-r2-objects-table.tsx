import { faDownload, faFile, faFolder, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'

import { basename, formatBytes } from './shared'

import type { CloudflareR2Object } from '../../types'

export type R2Row =
  | { kind: 'prefix'; key: string; name: string; prefix: string }
  | { kind: 'object'; key: string; name: string; object: CloudflareR2Object }

export function R2ObjectsTable({
  teamId,
  accountId,
  bucketName,
  loading,
  rows,
  truncated,
  paging,
  cursor,
  onLoadMore,
  onNavigate,
  onPreview,
  onDeleted,
}: {
  teamId: string
  accountId: string
  bucketName: string
  loading: boolean
  rows: R2Row[]
  truncated: boolean
  paging: boolean
  cursor: string | null
  onLoadMore: () => void
  onNavigate: (prefix: string) => void
  onPreview: (preview: { key: string; text: string; truncated: boolean }) => void
  onDeleted: () => void
}) {
  const [pendingDelete, setPendingDelete] = useState<CloudflareR2Object | null>(null)

  return (
    <>
      <Table<R2Row>
        loading={loading}
        rows={rows}
        rowKey={(r) => r.key}
        onPrimaryAction={(r) => {
          if (r.kind === 'prefix') onNavigate(r.prefix)
          else
            api
              .atlasGetCloudflareR2ObjectPreview(teamId, accountId, bucketName, r.object.key)
              .then((p) => onPreview({ key: r.object.key, text: p.text, truncated: p.truncated }))
              .catch((e: unknown) => toast.apiError('Failed to load object preview', e))
        }}
        storageKey="cloudflare.r2.objects"
        empty="Empty"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 380,
            render: (r) =>
              r.kind === 'prefix' ? (
                <span className="flex items-center gap-2 text-secondary">
                  <FontAwesomeIcon icon={faFolder} className="w-3.5 h-3.5 text-tertiary" />
                  {r.name}/
                </span>
              ) : (
                <span className="flex items-center gap-2 text-main">
                  <FontAwesomeIcon icon={faFile} className="w-3.5 h-3.5 text-tertiary" />
                  {r.name}
                </span>
              ),
          },
          {
            key: 'size',
            header: 'Size',
            width: 100,
            render: (r) =>
              r.kind === 'object' ? (
                <span className="text-secondary">{formatBytes(r.object.size)}</span>
              ) : (
                ''
              ),
          },
          {
            key: 'modified',
            header: 'Modified',
            width: 110,
            render: (r) =>
              r.kind === 'object' ? (
                <span className="text-tertiary">
                  <Age value={r.object.lastModified} />
                </span>
              ) : (
                ''
              ),
          },
          {
            key: 'actions',
            header: '',
            width: 72,
            render: (r) =>
              r.kind === 'object' ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      api
                        .atlasGetCloudflareR2ObjectDownloadUrl(
                          teamId,
                          accountId,
                          bucketName,
                          r.object.key,
                        )
                        .then((url) => api.appOpenExternal(url))
                        .catch((err: unknown) =>
                          toast.apiError('Failed to download object', err, {
                            fallback: 'Check your connection and try again.',
                          }),
                        )
                    }}
                    className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
                    title="Download"
                  >
                    <FontAwesomeIcon icon={faDownload} className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(r.object)
                    }}
                    className="w-6 h-6 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                    title="Delete"
                  >
                    <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null,
          },
        ]}
      />
      {truncated && (
        <div className="px-4 py-2 border-t border-zGray-850 flex items-center justify-center">
          <button
            onClick={onLoadMore}
            disabled={paging || !cursor}
            className="px-3 py-1 rounded-md bg-zGray-850 hover:bg-zGray-800 text-secondary text-[12px] disabled:opacity-50"
          >
            {paging ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete object?"
        description={pendingDelete ? `"${pendingDelete.key}" will be permanently deleted.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflareR2Object(
              teamId,
              accountId,
              bucketName,
              pendingDelete.key,
            )
            toast.success('Object deleted')
            onDeleted()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  )
}

export function R2ObjectPreviewPanel({
  preview,
  bucketName,
  onClose,
}: {
  preview: { key: string; text: string; truncated: boolean }
  bucketName: string
  onClose: () => void
}) {
  return (
    <LeafDetailPanel
      open
      onClose={onClose}
      title={basename(preview.key)}
      subtitle={`Object · ${bucketName}`}
      fields={[
        { label: 'Key', value: preview.key, mono: true, full: true },
        {
          label: `Preview${preview.truncated ? ' (truncated)' : ''}`,
          full: true,
          value: (
            <pre className="text-[11.5px] font-mono text-secondary whitespace-pre-wrap break-all max-h-[50vh] overflow-auto">
              {preview.text}
            </pre>
          ),
        },
      ]}
    />
  )
}
