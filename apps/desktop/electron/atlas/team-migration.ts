import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { BrowserWindow, dialog } from 'electron'

import { accountSignal, signedIn, stillCurrent } from '../account-request'

import { buildAtlasError } from './error'

import type { IpcMainInvokeEvent } from 'electron'

export async function saveTeamExport(event: IpcMainInvokeEvent, teamId: string): Promise<boolean> {
  if (!/^[a-f0-9]{24}$/.test(teamId)) throw new Error('Invalid team ID')
  const account = await signedIn()
  const parent = BrowserWindow.fromWebContents(event.sender)
  const chosen = await dialog.showSaveDialog(parent ?? (undefined as never), {
    title: 'Export team data',
    defaultPath: 'nuphos-team.zip',
    filters: [{ name: 'Team ZIP archive', extensions: ['zip'] }],
  })

  stillCurrent(account)
  if (chosen.canceled || !chosen.filePath) return false
  const response = await fetch(`${account.api}/teams/${teamId}/migration/export`, {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}` },
    signal: accountSignal(account, 120_000),
  })

  stillCurrent(account)
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string }
    } | null

    throw buildAtlasError(
      failure?.error?.message ?? 'Could not export team data',
      failure?.error?.code,
    )
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('application/zip'))
    throw new Error('The server did not return a team ZIP archive')
  const temporary = `${chosen.filePath}.${crypto.randomUUID()}.partial`
  let bytes = 0
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        stillCurrent(account)
        bytes += chunk.byteLength
        if (bytes > 100 * 1024 * 1024) throw new Error('Team ZIP exceeds 100 MiB')
        callback(null, chunk)
      } catch (error) {
        callback(error as Error)
      }
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      bound,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    )
    stillCurrent(account)
    await rename(temporary, chosen.filePath)

    return true
  } finally {
    await rm(temporary, { force: true })
  }
}
