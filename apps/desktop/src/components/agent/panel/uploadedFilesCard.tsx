import clsx from 'clsx'
import { CircleAlert, File, Folder, Loader2 } from 'lucide-react'

import { t } from '../../../i18n'
import { useReportVisibleError } from '../../VisibleErrorReporter'

import { filesBesidePreviews, previewKind } from './transferDownloads'
import { TransferPreviews } from './transferPreviews'
import { UploadingPreviews } from './UploadingPreviews'

import type { TransferUploadPart } from './parts'

// User-uploaded files. Bytes already live in the transfer store;
// the agent pulls them into its sandbox. Read-only card (no actions here).
// Media preview above it; the card lists only the rest, or is dropped when none is left.
export function UploadedFilesCard({
  part,
  teamId,
  channelId,
  alignEnd = true,
}: {
  part: TransferUploadPart
  teamId?: string
  /** See TransferPreviews: a chat's uploads load through the chat. */
  channelId?: string
  /** Right-aligned, as the viewer's own files are. */
  alignEnd?: boolean
}) {
  const previewTeam =
    part.status !== 'uploading' &&
    part.status !== 'error' &&
    part.groupId &&
    !part.archive &&
    part.files.some((f) => previewKind(f))
      ? teamId
      : undefined

  if (!previewTeam) return <UploadedFilesList part={part} rows={part.files} />

  return (
    <div
      className={clsx(
        'flex max-w-[480px] flex-col',
        alignEnd ? 'items-end self-end' : 'items-start self-start',
      )}
    >
      <TransferPreviews
        teamId={previewTeam}
        groupId={part.groupId}
        expected={part.files.filter((f) => previewKind(f)).length}
        alignEnd={alignEnd}
        channelId={channelId}
      >
        {(previewed) => {
          const rows = filesBesidePreviews(part.files, previewed)

          return rows.length > 0 && <UploadedFilesList part={part} rows={rows} />
        }}
      </TransferPreviews>
    </div>
  )
}

function UploadedFilesList({
  part,
  rows,
}: {
  part: TransferUploadPart
  rows: TransferUploadPart['files']
}) {
  const uploading = part.status === 'uploading'
  const errored = part.status === 'error'

  useReportVisibleError(errored ? 'Agent attachment upload failed.' : null, 'agent_upload_failed')
  const entries = part.archiveEntryCount
  const listed = uploading ? rows.filter((file) => !file.previewUrl) : rows

  return (
    <>
      <UploadingPreviews files={uploading ? rows : []} />
      <div className="flex max-w-[480px] flex-wrap justify-end gap-1.5 self-end">
        {listed.map((f, i) => {
          const failed = errored || f.status === 'failed'
          const Icon = uploadIcon(uploading, failed, part.archive)

          return (
            <span
              key={`${f.fileName}:${String(i)}`}
              className={clsx(
                'flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-surface px-3 text-[13px]',
                failed ? 'border-error/30 text-error' : 'border-line-control text-main',
              )}
            >
              <Icon
                className={clsx(
                  'h-3.5 w-3.5 flex-shrink-0',
                  uploading && 'animate-spin',
                  !failed && 'text-tertiary',
                )}
              />
              <span className="truncate">{f.fileName}</span>
              {failed ? (
                <span className="flex-shrink-0 text-[12px]">{t('Upload failed')}</span>
              ) : (
                part.archive &&
                entries != null && (
                  <span className="flex-shrink-0 text-[12px] text-tertiary">
                    · {entries === 1 ? t('1 file') : t('{n} files', { n: String(entries) })}
                  </span>
                )
              )}
            </span>
          )
        })}
      </div>
    </>
  )
}

function uploadIcon(uploading: boolean, failed: boolean, archive?: boolean) {
  if (uploading) return Loader2
  if (failed) return CircleAlert

  return archive ? Folder : File
}
