import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'

import { BrowserWindow, dialog } from 'electron'

import { accountSignal, signedIn, stillCurrent } from '../account-request'

import { buildAtlasError } from './error'

import type { AtlasTeam } from '../../src/types'
import type { TeamImportPreview } from '../../src/types/team-migration'
import type { SignedIn } from '../account-request'
import type { IpcMainInvokeEvent } from 'electron'

const pending = new Map<
  number,
  { token: string; path: string; sha256: string; account: SignedIn; expires: number }
>()

async function zipBytes(path: string) {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of createReadStream(path)) {
    size += (chunk as Buffer).byteLength
    if (size > 100 * 1024 * 1024) throw new Error('Team ZIP exceeds 100 MiB')
    chunks.push(chunk as Buffer)
  }

  return Buffer.concat(chunks)
}

async function upload<T>(
  account: SignedIn,
  action: 'preview' | 'import',
  bytes: Buffer,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${account.api}/teams/migration/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${account.token}`,
      'Content-Type': 'application/zip',
      ...headers,
    },
    body: bytes,
    signal: accountSignal(account, 120_000),
  })

  stillCurrent(account)
  const value = (await response.json()) as T & { error?: { message?: string; code?: string } }

  if (!response.ok)
    throw buildAtlasError(value?.error?.message ?? 'Could not import team data', value?.error?.code)

  return value
}

export async function previewTeamImport(
  event: IpcMainInvokeEvent,
): Promise<TeamImportPreview | null> {
  const account = await signedIn()
  const parent = BrowserWindow.fromWebContents(event.sender)
  const chosen = await dialog.showOpenDialog(parent ?? (undefined as never), {
    title: 'Import team data',
    properties: ['openFile'],
    filters: [{ name: 'Team ZIP archive', extensions: ['zip'] }],
  })

  stillCurrent(account)
  const path = chosen.filePaths[0]

  if (chosen.canceled || !path) return null
  const bytes = await zipBytes(path)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const preview = await upload<Omit<TeamImportPreview, 'token'>>(account, 'preview', bytes)

  if (preview.sha256 !== sha256) throw new Error('The server preview does not match this ZIP')
  const token = randomUUID()
  const entry = { token, path, sha256, account, expires: Date.now() + 10 * 60_000 }

  pending.set(event.sender.id, entry)
  account.signal.addEventListener(
    'abort',
    () => {
      if (pending.get(event.sender.id) === entry) pending.delete(event.sender.id)
    },
    { once: true },
  )

  return { ...preview, token }
}

export async function confirmTeamImport(
  event: IpcMainInvokeEvent,
  token: string,
  sourceMember?: string,
): Promise<AtlasTeam> {
  const entry = pending.get(event.sender.id)

  if (entry?.token !== token || entry.expires < Date.now())
    throw new Error('Choose the team ZIP again')
  stillCurrent(entry.account)
  const bytes = await zipBytes(entry.path)

  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error('The ZIP changed; choose it again')
  const result = await upload<{ team: AtlasTeam }>(entry.account, 'import', bytes, {
    'X-Migration-SHA256': entry.sha256,
    ...(sourceMember ? { 'X-Migration-Source-Member': sourceMember } : {}),
  })

  pending.delete(event.sender.id)

  return result.team
}
