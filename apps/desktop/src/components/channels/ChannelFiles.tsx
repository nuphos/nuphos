import { useEffect, useState } from 'react'

import { api } from '../../api'
import { DownloadFilesCard, UploadedFilesCard } from '../agent/panel/transferCards'

import type { channelFiles } from './postFiles'
import type { FileTransferGroup } from '../../types'

/** An agent's pushed files, drawn as the download card its own chat shows. */
function PushedFiles({
  teamId,
  channelId,
  groupId,
}: {
  teamId: string
  channelId: string
  groupId: string
}) {
  const [group, setGroup] = useState<FileTransferGroup | null>(null)

  useEffect(() => {
    let live = true

    void api
      .fileTransferResolve({ teamId, groupId, channelId })
      .then((resolved) => {
        if (live) setGroup(resolved)
      })
      .catch(() => {
        // Gone or expired: the words still stand on their own.
      })

    return () => {
      live = false
    }
  }, [teamId, channelId, groupId])

  return group && <DownloadFilesCard group={group} teamId={teamId} channelId={channelId} />
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
      {files.downloads.map((groupId) => (
        <PushedFiles key={groupId} teamId={teamId} channelId={channelId} groupId={groupId} />
      ))}
    </>
  )
}
