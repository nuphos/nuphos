import { BrowserWindow, dialog, shell } from 'electron'

import * as fileTransfer from '../fileTransfer'

import type { IpcMainInvokeEvent } from 'electron'

// The most a preview may read into memory, whatever the renderer asks for.
const READ_BYTES_MAX = 25 * 1024 * 1024

// Transfer files read back or saved to disk.
export const fileTransferReadChannels = {
  // The renderer's PDF preview reads its bytes here rather than fetching the
  // presigned link: the store sends no CORS headers and serves an attachment.
  'fileTransfer:readOne': (
    _e: IpcMainInvokeEvent,
    args: {
      teamId: string
      sessionId?: string
      groupId: string
      fileId: string
      maxBytes: number
    },
  ) =>
    fileTransfer.readOne({
      ...args,
      maxBytes: Number.isFinite(args.maxBytes)
        ? Math.min(args.maxBytes, READ_BYTES_MAX)
        : READ_BYTES_MAX,
    }),
  'fileTransfer:revealInFolder': (_e: IpcMainInvokeEvent, path: string) => {
    if (path) shell.showItemInFolder(path)
  },
  'fileTransfer:downloadOne': async (
    e: IpcMainInvokeEvent,
    args: {
      teamId: string
      sessionId?: string
      groupId: string
      fileId: string
      fileName: string
      channelId?: string
    },
  ) => {
    const parentWindow = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showSaveDialog(
      parentWindow && !parentWindow.isDestroyed() ? parentWindow : (undefined as never),
      { defaultPath: args.fileName },
    )

    if (result.canceled || !result.filePath) return { saved: false }
    await fileTransfer.downloadOne({ ...args, destPath: result.filePath })

    return { saved: true, path: result.filePath }
  },
  'fileTransfer:downloadAllZip': async (
    e: IpcMainInvokeEvent,
    args: {
      teamId: string
      sessionId?: string
      groupId: string
      zipName: string
      channelId?: string
    },
  ) => {
    const parentWindow = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showSaveDialog(
      parentWindow && !parentWindow.isDestroyed() ? parentWindow : (undefined as never),
      { defaultPath: args.zipName.endsWith('.zip') ? args.zipName : `${args.zipName}.zip` },
    )

    if (result.canceled || !result.filePath) return { saved: false }
    const out = await fileTransfer.downloadAllAsZip({
      teamId: args.teamId,
      sessionId: args.sessionId,
      groupId: args.groupId,
      channelId: args.channelId,
      destZipPath: result.filePath,
    })

    return { saved: true, path: result.filePath, ...out }
  },
} as const
