import { api } from '../../../api'
import { t } from '../../../i18n'
import { toast } from '../../ui/toast'

import { DownloadFilesCard } from './transferCards'
import { previewKind } from './transferDownloads'
import { TransferPreviews } from './transferPreviews'

import type { FileTransferGroup } from '../../../types'

/**
 * The files one message produced, however many pushes they took: their images,
 * videos and audio as one row of squares with one pager, then each group's other
 * files as its own card, which also says when it expired. A single group is
 * just its card.
 */
export function DownloadGroups({
  groups,
  teamId,
  channelId,
}: {
  groups: readonly FileTransferGroup[]
  teamId: string
  /** Posted in a chat: every member opens and saves it through the chat. */
  channelId?: string
}) {
  if (groups.length <= 1)
    return (
      <>
        {groups.map((group) => (
          <DownloadFilesCard
            key={group.groupId}
            group={group}
            teamId={teamId}
            channelId={channelId}
          />
        ))}
      </>
    )
  const media = groups.flatMap((group) =>
    group.files.filter((file) => file.status === 'ready' && previewKind(file) !== null),
  ).length

  return (
    <div className="flex w-full max-w-[85%] flex-col self-start">
      {media > 0 && (
        <TransferPreviews
          teamId={teamId}
          groupId={groups.map((group) => group.groupId)}
          channelId={channelId}
          expected={media}
          onDownload={(file) => {
            void api
              .fileTransferDownloadOne({
                teamId,
                groupId: file.groupId,
                fileId: file.id,
                fileName: file.fileName,
                ...(channelId ? { channelId } : {}),
              })
              .then((saved) => {
                if (saved.saved) toast.success(t('Saved'), file.fileName)
              })
              .catch((error: unknown) => toast.apiError(t('Download failed'), error))
          }}
        />
      )}
      {groups.map((group) => (
        <DownloadFilesCard
          key={group.groupId}
          group={group}
          teamId={teamId}
          channelId={channelId}
          previews={false}
        />
      ))}
    </div>
  )
}
