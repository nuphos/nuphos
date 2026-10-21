import { resolveThisComputerFile } from './linked-file.ts'

import type { TransferGroup } from '../fileTransfer/types.ts'

type Args = [teamId: string, runtimeId: string, sessionId: string, path: string]
type Transfer = { groupId: string; fileId: string; fileName: string; size: number; url: string }
type Dependencies = {
  uploadFiles: (args: { teamId: string; filePaths: string[] }) => Promise<TransferGroup>
  resolveDownloads: (
    teamId: string,
    sessionId: undefined,
    groupId: string,
  ) => Promise<TransferGroup>
  transferRuntimeFile: (...args: Args) => Promise<Transfer>
}

/** Linked media uses the same local-first lookup as small linked files. A local
 * copy uses the existing transfer store so playback and seeking share one path.
 * Without a session id the copy does not create a chat attachment. */
export async function transferLinkedFile(args: Args, workspace: string | null, deps: Dependencies) {
  const target = await resolveThisComputerFile(args[3], workspace)

  if (!target) return { ...(await deps.transferRuntimeFile(...args)), origin: 'agent' as const }
  const group = await deps.uploadFiles({ teamId: args[0], filePaths: [target] })
  const resolved = await deps.resolveDownloads(args[0], undefined, group.groupId)
  const file = resolved.files.find((entry) => entry.id === group.files[0]?.id)

  if (!file?.downloadUrl || file.status !== 'ready' || file.size === null)
    throw new Error('The local file could not be prepared for preview.')

  return {
    groupId: resolved.groupId,
    fileId: file.id,
    fileName: file.fileName,
    size: file.size,
    url: file.downloadUrl,
    origin: 'this-computer' as const,
  }
}
