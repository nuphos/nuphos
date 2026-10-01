import { Copy, Download, Globe } from 'lucide-react'

import { api } from '../../api'

import { s3ConsoleBucketUrl, s3ConsoleObjectUrl, s3Uri } from './s3-helpers'

import type { ContextMenuItem } from '../../components/ContextMenu'
import type { AwsS3Bucket, AwsS3Object } from '../../types'

export type BucketRow =
  | { kind: 'prefix'; key: string; name: string; prefix: string }
  | { kind: 'object'; key: string; name: string; object: AwsS3Object }

export function buildRowMenu(
  row: BucketRow,
  linkItems: ContextMenuItem[],
  bucket: AwsS3Bucket,
  downloadObject: ((key: string) => Promise<void>) | undefined,
): ContextMenuItem[] {
  const sep: ContextMenuItem[] =
    linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []

  if (row.kind === 'prefix') {
    return [
      ...linkItems,
      ...sep,
      {
        key: 'copy-uri',
        label: 'Copy S3 URI',
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(s3Uri(bucket.name, row.prefix)),
      },
      {
        key: 'open-console',
        label: 'Open in AWS console',
        icon: Globe,
        onSelect: () => void api.appOpenExternal(s3ConsoleBucketUrl(bucket, row.prefix)),
      },
    ]
  }

  return [
    ...linkItems,
    ...sep,
    ...(downloadObject
      ? [
          {
            key: 'download',
            label: 'Download',
            icon: Download,
            onSelect: () => void downloadObject(row.object.key),
          },
        ]
      : []),
    {
      key: 'copy-uri',
      label: 'Copy S3 URI',
      icon: Copy,
      onSelect: () => void navigator.clipboard.writeText(s3Uri(bucket.name, row.object.key)),
    },
    {
      key: 'copy-key',
      label: 'Copy object key',
      icon: Copy,
      onSelect: () => void navigator.clipboard.writeText(row.object.key),
    },
    {
      key: 'open-console',
      label: 'Open in AWS console',
      icon: Globe,
      onSelect: () => void api.appOpenExternal(s3ConsoleObjectUrl(bucket, row.object.key)),
    },
  ]
}
