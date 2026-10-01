import { Copy, Globe } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { ContextMenu } from '../../components/ContextMenu'
import { useReportLoading } from '../../components/useReportLoading'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResetOnKey } from '../useResetOnKey'

import { ErrorBlock } from './ErrorBlock'
import { buildRowMenu } from './s3-bucket-rows'
import { s3ConsoleBucketUrl, s3Uri } from './s3-helpers'
import { S3ObjectPreviewPanel } from './s3-object-preview'
import { S3ObjectsTable } from './s3-objects-table'
import { applyFilter, basename } from './shared'

import type { BucketRow } from './s3-bucket-rows'
import type { AwsS3Bucket, AwsS3Object, AwsS3ObjectListing, AwsS3ObjectPreview } from '../../types'

export function S3BucketDetailView({
  bucketName,
  region,
  prefix,
  onNavigate,
  loader,
  getDownloadUrl,
  getPreview,
  getRowLink,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: {
  bucketName: string
  region: string
  prefix: string
  onNavigate: (prefix: string) => void
  loader: (prefix: string, continuationToken: string | null) => Promise<AwsS3ObjectListing>
  getDownloadUrl?: (key: string) => Promise<string>
  getPreview?: (key: string) => Promise<AwsS3ObjectPreview>
  getRowLink?: (row: BucketRow) => string | null
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}) {
  const bucket: AwsS3Bucket = { name: bucketName, region, createdAt: null }
  const [prefixes, setPrefixes] = useState<string[]>([])
  const [objects, setObjects] = useState<AwsS3Object[]>([])
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [isTruncated, setIsTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [paging, setPaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ row: BucketRow; x: number; y: number } | null>(null)
  const [selectedObject, setSelectedObject] = useState<AwsS3Object | null>(null)
  // Monotonic counter incremented on every prefix/refreshKey change. Both the
  // initial-load effect and loadMore capture the current value; if it changes
  // while a request is in-flight (e.g. user navigates into a different folder
  // mid-page), the stale response is discarded so it can't pollute the new
  // listing or leave `paging` stuck true.
  const requestGenRef = useRef(0)

  useReportLoading(loading || paging, onLoading)

  async function downloadObject(key: string) {
    if (!getDownloadUrl) return
    try {
      const url = await getDownloadUrl(key)

      await api.appOpenExternal(url)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  useResetOnKey(`${prefix}|${String(refreshKey)}`, () => {
    setLoading(true)
    setPaging(false)
    setError(null)
    setPrefixes([])
    setObjects([])
    setNextToken(null)
    setIsTruncated(false)
  })
  useEffect(() => {
    const gen = ++requestGenRef.current

    loader(prefix, null)
      .then((res) => {
        if (requestGenRef.current !== gen) return
        setPrefixes(res.prefixes)
        setObjects(res.objects)
        setNextToken(res.nextContinuationToken)
        setIsTruncated(res.isTruncated)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (requestGenRef.current !== gen) return
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, refreshKey])

  const loadMore = useCallback(() => {
    if (!nextToken || paging) return
    const gen = requestGenRef.current

    setPaging(true)
    loader(prefix, nextToken)
      .then((res) => {
        if (requestGenRef.current !== gen) return
        setPrefixes((prev) => [...prev, ...res.prefixes])
        setObjects((prev) => [...prev, ...res.objects])
        setNextToken(res.nextContinuationToken)
        setIsTruncated(res.isTruncated)
        setPaging(false)
      })
      .catch((e: unknown) => {
        if (requestGenRef.current !== gen) return
        setError(String(e instanceof Error ? e.message : e))
        setPaging(false)
      })
  }, [nextToken, paging, loader, prefix])

  const rows: BucketRow[] = [
    ...prefixes.map<BucketRow>((p) => ({
      kind: 'prefix',
      key: `p:${p}`,
      name: `${basename(p)}/`,
      prefix: p,
    })),
    ...objects.map<BucketRow>((o) => ({
      kind: 'object',
      key: `o:${o.key}`,
      name: o.key.startsWith(prefix) ? o.key.slice(prefix.length) : o.key,
      object: o,
    })),
  ]

  const filtered = applyFilter(rows, filter, (r) => r.name)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const linkActions = useRowLinkActions<BucketRow>(getRowLink)

  return (
    <div className="flex flex-col h-full">
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildRowMenu(
            menu.row,
            linkActions(menu.row),
            bucket,
            getDownloadUrl ? downloadObject : undefined,
          )}
          onClose={() => setMenu(null)}
        />
      )}

      <div className="px-4 py-2 border-b border-zGray-800 flex items-center gap-3 text-[11.5px]">
        <span className="text-tertiary truncate" title={s3Uri(bucket.name, prefix)}>
          {s3Uri(bucket.name, prefix)}
        </span>
        <span className="text-secondary px-1.5 py-0.5 rounded bg-zGray-800/60">
          {bucket.region || 'us-east-1'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(s3Uri(bucket.name, prefix))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
            title="Copy S3 URI of this location"
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
            Copy URI
          </button>
          <button
            type="button"
            onClick={() => void api.appOpenExternal(s3ConsoleBucketUrl(bucket, prefix))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
            title="Open this location in the AWS S3 console"
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            AWS console
          </button>
        </div>
      </div>

      {error ? (
        <ErrorBlock message={error} />
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <S3ObjectsTable
              loading={loading}
              rows={filtered}
              bucketName={bucket.name}
              empty={
                filter
                  ? `No items matching "${filter}"`
                  : prefix
                    ? 'This folder is empty'
                    : 'This bucket is empty'
              }
              onRowClick={(r) => {
                if (r.kind === 'prefix') {
                  setSelectedObject(null)
                  onNavigate(r.prefix)
                } else {
                  setSelectedObject(r.object)
                }
              }}
              onRowContextMenu={(r, e) => setMenu({ row: r, x: e.clientX, y: e.clientY })}
            />

            {isTruncated && (
              <div className="px-4 py-2 border-t border-zGray-800 flex items-center justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={paging || !nextToken}
                  className="text-[12px] text-zViolet-accent hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {paging ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
          {selectedObject && (
            <S3ObjectPreviewPanel
              key={selectedObject.key}
              bucket={bucket}
              object={selectedObject}
              onClose={() => setSelectedObject(null)}
              onDownload={() => void downloadObject(selectedObject.key)}
              getDownloadUrl={getDownloadUrl}
              getPreview={getPreview}
            />
          )}
        </div>
      )}
    </div>
  )
}
