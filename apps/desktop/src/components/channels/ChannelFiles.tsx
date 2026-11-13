import { useEffect, useState } from 'react'

import { api } from '../../api'
import { DownloadGroups } from '../agent/panel/DownloadGroups'
import { UploadedFilesCard } from '../agent/panel/uploadedFilesCard'

import type { channelFiles } from './postFiles'
import type { FileTransferGroup } from '../../types'

/** An agent's pushed files, drawn as the files its own chat shows. */
function PushedFiles({
  teamId,
  channelId,
  groupIds,
}: {
  teamId: string
  channelId: string
  groupIds: readonly string[]
}) {
  const [groups, setGroups] = useState<FileTransferGroup[]>([])
  // A stable key for the effect: the ids come from the post.
  const ids = groupIds.join(',')

  useEffect(() => {
    let live = true

    void Promise.all(
      ids
        .split(',')
        .map((groupId) =>
          api.fileTransferResolve({ teamId, groupId, channelId }).catch(() => null),
        ),
    ).then((resolved) => {
      // Gone or expired: the words still stand on their own.
      if (live) setGroups(resolved.filter((group) => group !== null))
    })

    return () => {
      live = false
    }
  }, [teamId, channelId, ids])

  return <DownloadGroups groups={groups} teamId={teamId} channelId={channelId} />
}

/** A post's files, drawn with the conversation's cards. */
export function ChannelFiles({
  files,
  teamId,
  channelId,
  mine,
}: {
  files: ReturnType<typeof channelFiles>
  teamId: string
  channelId: string
  mine: boolean
}) {
  return (
    <>
      {files.uploads.map((part, i) => (
        <UploadedFilesCard
          key={`u${String(i)}`}
          part={part}
          teamId={teamId}
          channelId={channelId}
          alignEnd={mine}
        />
      ))}
      {files.downloads.length > 0 && (
        <PushedFiles teamId={teamId} channelId={channelId} groupIds={files.downloads} />
      )}
    </>
  )
}
