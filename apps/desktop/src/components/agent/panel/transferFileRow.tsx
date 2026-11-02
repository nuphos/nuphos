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

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { formatTransferBytes } from './transferDownloads'

import type { FileTransferGroup } from '../../../types'
import type { LucideIcon } from 'lucide-react'

// One file: type tile, name, "PDF · 237.9 KB", and its action. Rows in a group
// get an icon-only button so a long list doesn't repeat "Download".
export function FileRow({
  file: f,
  expired,
  compact,
  busy,
  onDownload,
}: {
  file: FileTransferGroup['files'][number]
  expired: boolean
  compact: boolean
  busy: string | null
  onDownload: () => void
}) {
  const failed = f.status === 'failed'
  const { Icon, color } = failed ? { Icon: FileX, color: 'text-error' } : fileKind(f.fileName)

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2.5 [&+&]:border-t [&+&]:border-zGray-850',
        expired && 'opacity-50',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
          failed ? 'bg-error/10' : 'bg-zGray-850',
          color,
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium text-main" title={f.relPath}>
          {f.fileName}
        </span>
        <span className={clsx('text-[12px]', failed ? 'text-error' : 'text-tertiary')}>
          {failed ? t('Failed') : fileMeta(f.fileName, f.size)}
        </span>
      </span>
      {!expired && f.status === 'ready' && (
        <Button
          variant="secondary"
          size={compact ? 'icon-sm' : 'sm'}
          onClick={onDownload}
          disabled={busy !== null}
          aria-label={t('Download')}
          title={t('Download')}
          className={clsx('flex-shrink-0', compact ? 'h-[30px] w-[30px]' : 'gap-1.5')}
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

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')

  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

// "PDF · 237.9 KB"
function fileMeta(fileName: string, size: number | null): string {
  return [extension(fileName).toUpperCase(), formatTransferBytes(size)].filter(Boolean).join(' · ')
}

const KINDS: { exts: string[]; Icon: LucideIcon; color: string }[] = [
  { exts: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'], Icon: FileArchive, color: 'text-amber-500' },
  { exts: ['pdf'], Icon: FileText, color: 'text-red-500' },
  {
    exts: ['xlsx', 'xls', 'csv', 'tsv', 'numbers'],
    Icon: FileSpreadsheet,
    color: 'text-emerald-500',
  },
  { exts: ['md', 'txt', 'doc', 'docx', 'rtf'], Icon: FileText, color: 'text-blue-500' },
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
    color: 'text-violet-500',
  },
]

function fileKind(fileName: string): { Icon: LucideIcon; color: string } {
  const ext = extension(fileName)

  return KINDS.find((k) => k.exts.includes(ext)) ?? { Icon: File, color: 'text-tertiary' }
}
