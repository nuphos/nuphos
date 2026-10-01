import { Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { S3BucketDetailView } from './s3-bucket-detail'
import { s3ConsoleBucketUrl } from './s3-helpers'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AwsS3Bucket, AwsS3ObjectListing, AwsS3ObjectPreview } from '../../types'

export type S3DetailValue = {
  bucket: string
  region: string
  prefix: string
}

export function S3BucketsView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
  objectLoader,
  downloadUrlLoader,
  previewLoader,
  s3Detail,
  setS3Detail,
}: CommonProps & {
  loader: ResourceListLoader<AwsS3Bucket>
  getRowLink?: (bucket: AwsS3Bucket) => string
  objectLoader?: (
    bucket: AwsS3Bucket,
    prefix: string,
    continuationToken: string | null,
  ) => Promise<AwsS3ObjectListing>
  downloadUrlLoader?: (bucket: AwsS3Bucket, key: string) => Promise<string>
  previewLoader?: (bucket: AwsS3Bucket, key: string) => Promise<AwsS3ObjectPreview>
  s3Detail?: S3DetailValue | null
  setS3Detail?: (d: S3DetailValue | null) => void
}) {
  const [menu, setMenu] = useState<{ bucket: AwsS3Bucket; x: number; y: number } | null>(null)
  const missingDetailToastRef = useRef<string | null>(null)
  const { pollTick } = useWorkspaceTab()
  const inDetail = !!s3Detail
  const needsDetailRegion = !!s3Detail && !s3Detail.region
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, {
    enabled: !inDetail || needsDetailRegion,
    pollTick,
  })

  const linkActions = useRowLinkActions(getRowLink)

  function buildBucketMenu(bucket: AwsS3Bucket): ContextMenuItem[] {
    const linkItems = linkActions(bucket)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'open-in-browser',
        label: 'Open in AWS console',
        icon: Globe,
        onSelect: () => {
          void api.appOpenExternal(s3ConsoleBucketUrl(bucket))
        },
      },
    ]
  }

  const filtered = applyFilter(items, filter, (b) => `${b.name} ${b.region}`)

  useEffect(() => {
    if (!inDetail) onCount(filtered.length)
  }, [filtered.length, onCount, inDetail])

  const resolvedDetailBucket = s3Detail ? items.find((b) => b.name === s3Detail.bucket) : undefined
  const detailRegion = s3Detail ? s3Detail.region || resolvedDetailBucket?.region || '' : ''
  const missingDetailKey =
    s3Detail && objectLoader && setS3Detail && !loading && !error && !detailRegion
      ? s3Detail.bucket
      : null

  useEffect(() => {
    if (!missingDetailKey) {
      missingDetailToastRef.current = null

      return
    }
    if (missingDetailToastRef.current !== missingDetailKey) {
      toast.error('Could not open bucket', `S3 bucket ${missingDetailKey} was not found.`)
      missingDetailToastRef.current = missingDetailKey
    }
    setS3Detail?.(null)
  }, [missingDetailKey, setS3Detail])

  if (s3Detail && objectLoader && setS3Detail) {
    if (!detailRegion) {
      if (error) return <ErrorBlock message={error} />
      if (loading) {
        return (
          <div className="h-full flex items-center justify-center text-sm text-tertiary">
            Loading bucket...
          </div>
        )
      }

      return <div className="h-full" />
    }

    const bucketObj: AwsS3Bucket = {
      name: s3Detail.bucket,
      region: detailRegion,
      createdAt: null,
    }
    const bucketHref = getRowLink?.(bucketObj) ?? null
    const subLink = (sub: string): string | null => {
      if (!bucketHref || !sub) return bucketHref
      const trailing = sub.endsWith('/') ? '/' : ''
      const segs = sub.replace(/\/$/, '').split('/').filter(Boolean).map(encodeURIComponent)

      return `${bucketHref}/${segs.join('/')}${trailing}`
    }

    return (
      <S3BucketDetailView
        bucketName={s3Detail.bucket}
        region={detailRegion}
        prefix={s3Detail.prefix}
        onNavigate={(prefix) =>
          setS3Detail({ bucket: s3Detail.bucket, region: detailRegion, prefix })
        }
        loader={(prefix, token) => objectLoader(bucketObj, prefix, token)}
        getDownloadUrl={
          downloadUrlLoader ? (key: string) => downloadUrlLoader(bucketObj, key) : undefined
        }
        getPreview={previewLoader ? (key: string) => previewLoader(bucketObj, key) : undefined}
        getRowLink={
          bucketHref
            ? (row) => (row.kind === 'prefix' ? subLink(row.prefix) : subLink(row.object.key))
            : undefined
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildBucketMenu(menu.bucket)}
          onClose={() => setMenu(null)}
        />
      )}
      <Table<AwsS3Bucket>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={(b) => setS3Detail?.({ bucket: b.name, region: b.region, prefix: '' })}
        onRowContextMenu={(bucket, e) => setMenu({ bucket, x: e.clientX, y: e.clientY })}
        storageKey="aws.s3-buckets"
        defaultSort={{ key: 'name', dir: 'asc' }}
        empty="No S3 buckets"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 320,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="text-zViolet-accent truncate block" title={r.name}>
                {r.name}
              </span>
            ),
          },
          {
            key: 'region',
            header: 'Region',
            width: 160,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'created',
            header: 'Created',
            width: 100,
            sortAccessor: (r) => r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.createdAt} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
