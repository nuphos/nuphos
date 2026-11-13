import { useInfiniteQuery } from '@tanstack/react-query'
import { Copy, Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { ContextMenu } from '../../components/ContextMenu'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey } from '../../lib/query/tabQuery'
import { useRowLinkActions } from '../../lib/workspaceRowLink'

import { ErrorBlock } from './ErrorBlock'
import { buildRowMenu } from './s3-bucket-rows'
import { s3ConsoleBucketUrl, s3Uri } from './s3-helpers'
import { S3ObjectPreviewPanel } from './s3-object-preview'
import { S3ObjectsTable } from './s3-objects-table'
import { applyFilter, basename } from './shared'

import type { BucketRow } from './s3-bucket-rows'
import type { AwsS3Bucket, AwsS3Object, AwsS3ObjectListing, AwsS3ObjectPreview } from '../../types'

export function S3BucketDetailView({
  scope,
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
  /** Names the team, account and role the bucket is read through. */
  scope: string
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
  const [menu, setMenu] = useState<{ row: BucketRow; x: number; y: number } | null>(null)
  const [selectedObject, setSelectedObject] = useState<AwsS3Object | null>(null)
  // The loader is an inline closure recreated on every parent render; the key names the listing.
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })

  const listing = useInfiniteQuery({
    queryKey: queryKeys.s3Objects(scope, bucketName, prefix),
    queryFn: ({ pageParam }) => loaderRef.current(prefix, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.isTruncated ? (page.nextContinuationToken ?? undefined) : undefined,
  })
  const pages = listing.data?.pages ?? []
  const loading = listing.isPending
  const error = listing.error?.message ?? null

  useRefreshKey(
    { isPending: loading || listing.isFetchingNextPage, refetch: listing.refetch },
    refreshKey,
    onLoading,
  )

  async function downloadObject(key: string) {
    if (!getDownloadUrl) return
    try {
      const url = await getDownloadUrl(key)

      await api.appOpenExternal(url)
    } catch (e) {
      // A failed download says so and leaves the listing on screen.
      toast.apiError(t('Failed to download object'), e)
    }
  }

  const rows: BucketRow[] = [
    ...pages
      .flatMap((page) => page.prefixes)
      .map<BucketRow>((p) => ({
        kind: 'prefix',
        key: `p:${p}`,
        name: `${basename(p)}/`,
        prefix: p,
      })),
    ...pages
      .flatMap((page) => page.objects)
      .map<BucketRow>((o) => ({
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

      <div className="px-4 py-2 border-b border-line-control flex items-center gap-3 text-[11.5px]">
        <span className="text-tertiary truncate" title={s3Uri(bucket.name, prefix)}>
          {s3Uri(bucket.name, prefix)}
        </span>
        <span className="text-secondary px-1.5 py-0.5 rounded bg-state-selected">
          {bucket.region || 'us-east-1'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(s3Uri(bucket.name, prefix))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
            title={t('Copy S3 URI of this location')}
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('Copy URI')}
          </button>
          <button
            type="button"
            onClick={() => void api.appOpenExternal(s3ConsoleBucketUrl(bucket, prefix))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
            title={t('Open this location in the AWS S3 console')}
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('AWS console')}
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
                  ? t('No items matching "{filter}"', { filter })
                  : prefix
                    ? t('This folder is empty')
                    : t('This bucket is empty')
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

            {listing.hasNextPage && (
              <div className="px-4 py-2 border-t border-line-control flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => void listing.fetchNextPage()}
                  disabled={listing.isFetchingNextPage}
                  className="text-[12px] text-link hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {listing.isFetchingNextPage ? t('Loading…') : t('Load more')}
                </button>
              </div>
            )}
          </div>
          {selectedObject && (
            <S3ObjectPreviewPanel
              key={selectedObject.key}
              scope={scope}
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
