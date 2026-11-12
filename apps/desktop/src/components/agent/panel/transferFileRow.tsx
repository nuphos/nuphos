import clsx from 'clsx'
import {
  Download,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileX,
  Loader2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { useStableCallback } from '../../../hooks/useStableCallback'
import { t } from '../../../i18n'
import { filePreviewKind } from '../../../lib/filePreviews'
import { Button } from '../../ui/button'

import { openFilePreview, prefetchFilePreview } from './filePreview'
import { formatTransferBytes } from './transferDownloads'

import type { FileTransferGroup } from '../../../types'
import type { LucideIcon } from 'lucide-react'

// One file: type tile, name, "PDF · 237.9 KB", and its actions. Rows in a group
// get icon-only buttons so a long list doesn't repeat "Download". An HTML or
// Markdown file opens beside the chat when its row is clicked: the tile and
// name are one button whose hit area spans the row, and Download sits above it,
// so no control is nested in another.
const PREFETCH_ON_SHOW_BYTES = 256 * 1024

export function FileRow({
  file: f,
  expired,
  compact,
  busy,
  onDownload,
  preview,
}: {
  file: FileTransferGroup['files'][number]
  expired: boolean
  compact: boolean
  busy: string | null
  onDownload: () => void
  /** Where the file resolves, to open it in the dock; only HTML and Markdown files use it. */
  preview?: { teamId: string; groupId: string; channelId?: string }
}) {
  const [previewing, setPreviewing] = useState(false)
  const failed = f.status === 'failed'
  const canPreview =
    !expired && f.status === 'ready' && Boolean(preview && filePreviewKind(f.fileName))
  const source = canPreview && preview ? { ...preview, fileId: f.id } : null
  const prefetch = () => {
    if (source) prefetchFilePreview(source)
  }
  const small = f.size !== null && f.size <= PREFETCH_ON_SHOW_BYTES
  const row = usePrefetchWhenShown(source && small ? prefetch : null, f.id)
  const openPreview = () => {
    if (!preview || previewing) return
    setPreviewing(true)
    void openFilePreview({ ...preview, fileId: f.id, fileName: f.fileName }).finally(() =>
      setPreviewing(false),
    )
  }
  const { Icon, color } = failed ? { Icon: FileX, color: 'text-error' } : fileKind(f.fileName)
  const label = (
    <>
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
          failed ? 'bg-error/10' : 'bg-surface-sunken',
          color,
        )}
      >
        {/* While a preview is fetched, the file icon turns into a spinner. */}
        {previewing ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" />
        ) : (
          <Icon className="h-[18px] w-[18px]" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium text-main" title={f.relPath}>
          {f.fileName}
        </span>
        <span className={clsx('text-[12px]', failed ? 'text-error' : 'text-tertiary')}>
          {failed ? t('Failed') : fileMeta(f.fileName, f.size)}
        </span>
      </span>
    </>
  )

  return (
    <div
      ref={row}
      className={clsx(
        'relative flex items-center gap-3 px-3 py-2.5 [&+&]:border-t [&+&]:border-line-control',
        expired && 'opacity-50',
        canPreview &&
          'rounded-lg transition-colors hover:bg-state-hover has-[[data-file-preview]:focus-visible]:ring-2 has-[[data-file-preview]:focus-visible]:ring-inset has-[[data-file-preview]:focus-visible]:ring-line-focus motion-reduce:transition-none',
      )}
    >
      {canPreview ? (
        <button
          type="button"
          data-file-preview=""
          onClick={openPreview}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          aria-busy={previewing || undefined}
          aria-label={t('Preview {name}', { name: f.fileName })}
          title={t('Open beside the chat')}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none focus-visible:shadow-none after:absolute after:inset-0 after:content-['']"
        >
          {label}
        </button>
      ) : (
        label
      )}
      {!expired && f.status === 'ready' && (
        <Button
          variant="secondary"
          size={compact ? 'icon-sm' : 'sm'}
          onClick={onDownload}
          disabled={busy !== null}
          aria-label={t('Download')}
          title={t('Download')}
          // Above the preview button's row-wide hit area.
          className={clsx('relative flex-shrink-0', compact ? 'h-[30px] w-[30px]' : 'gap-1.5')}
        >
          {busy === f.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {!compact && t('Download')}
        </Button>
      )}
      {!expired && !failed && f.status !== 'ready' && (
        <Loader2 className="mr-2 h-3.5 w-3.5 flex-shrink-0 animate-spin text-tertiary" />
      )}
    </div>
  )
}

/**
 * Runs `prefetch` once, the first time the row scrolls into view, so a long
 * chat reads only the files someone actually scrolls past.
 */
function usePrefetchWhenShown(prefetch: (() => void) | null, key: string) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const run = useStableCallback(() => prefetch?.())
  const wanted = prefetch !== null

  useEffect(() => {
    if (!node || !wanted) return
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      seen.disconnect()
      run()
    })

    seen.observe(node)

    return () => seen.disconnect()
  }, [node, wanted, key, run])

  return setNode
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')

  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

// "PDF · 237.9 KB"
function fileMeta(fileName: string, size: number | null): string {
  return [extension(fileName).toUpperCase(), formatTransferBytes(size)].filter(Boolean).join(' · ')
}

const KINDS: { exts: string[]; Icon: LucideIcon; color: string }[] = [
  {
    exts: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'],
    Icon: FileArchive,
    color: 'text-status-warning',
  },
  { exts: ['pdf'], Icon: FileText, color: 'text-status-danger' },
  {
    exts: ['xlsx', 'xls', 'csv', 'tsv', 'numbers'],
    Icon: FileSpreadsheet,
    color: 'text-status-success',
  },
  { exts: ['md', 'txt', 'doc', 'docx', 'rtf'], Icon: FileText, color: 'text-data-1' },
  {
    exts: [
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'go',
      'rs',
      'sh',
      'json',
      'yaml',
      'yml',
      'toml',
      'sql',
      'html',
      'css',
    ],
    Icon: FileCode,
    color: 'text-secondary',
  },
]

function fileKind(fileName: string): { Icon: LucideIcon; color: string } {
  const ext = extension(fileName)

  return KINDS.find((k) => k.exts.includes(ext)) ?? { Icon: File, color: 'text-tertiary' }
}
