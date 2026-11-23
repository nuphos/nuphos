import { open, writeFile } from 'node:fs/promises'

import { dialog } from 'electron'

import { accountSignal, stillCurrent } from '../account-request'

import { agentAccount, callJsonForRenderer } from './http'

import type {
  BotImportPreview,
  BotImportSelection,
  BotImportTarget,
} from '../../src/api/bot-import-types'

const limit = 100 * 1024 * 1024
const query = (target: BotImportTarget) => `?${new URLSearchParams(target).toString()}`

async function chosenBytes() {
  const chosen = await dialog.showOpenDialog({
    title: 'Choose a Grok Bot export',
    properties: ['openFile'],
    filters: [{ name: 'Nuphos Bot bundle', extensions: ['zip'] }],
  })
  const path = chosen.filePaths[0]

  if (chosen.canceled || !path) return null
  const handle = await open(path, 'r')

  try {
    const stat = await handle.stat()

    if (!stat.isFile() || stat.size > limit) throw new Error('Choose a ZIP smaller than 100 MiB')
    const stream = handle.createReadStream({ start: 0, end: limit, autoClose: false })
    const chunks: Buffer[] = []
    let bytes = 0

    for await (const chunk of stream) {
      const data = Buffer.from(chunk as Uint8Array)

      bytes += data.length
      if (bytes > limit) throw new Error('Choose a ZIP smaller than 100 MiB')
      chunks.push(data)
    }

    return Buffer.concat(chunks)
  } finally {
    await handle.close()
  }
}

export async function chooseBotImport(
  target: BotImportTarget,
  newCopy = false,
): Promise<BotImportPreview | null> {
  const bytes = await chosenBytes()

  if (!bytes) return null
  const account = await agentAccount()
  const copyQuery = newCopy ? '&copyId=' + crypto.randomUUID() : ''
  const route = `/agent/bot-imports/preview${query(target)}${copyQuery}`
  const response = await fetch(`${account.api}${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/zip' },
    signal: accountSignal(account, 120_000),
    body: bytes,
  })

  stillCurrent(account)
  if (!response.ok) {
    if (response.status === 404)
      throw new Error(
        'This Nuphos server does not support Bot imports. Update it before importing.',
      )
    const failure = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null

    throw new Error(
      failure?.error?.message ??
        'The export could not be read. Check its format, size and contents, then try again.',
    )
  }

  return (await response.json()) as BotImportPreview
}

export function applyBotImport(target: BotImportTarget, id: string, selection: BotImportSelection) {
  return callJsonForRenderer<BotImportPreview>(
    'POST',
    `/agent/bot-imports/${encodeURIComponent(id)}/apply${query(target)}`,
    selection,
    120_000,
  )
}

export function getBotImportStatus(target: BotImportTarget, id: string) {
  return callJsonForRenderer<BotImportPreview>(
    'GET',
    `/agent/bot-imports/${encodeURIComponent(id)}${query(target)}`,
  )
}

export async function saveGrokExportSkill() {
  const account = await agentAccount()
  const response = await fetch(`${account.api}/agent/bot-imports/export-skill`, {
    headers: { authorization: `Bearer ${account.token}` },
    signal: accountSignal(account, 30_000),
  })

  stillCurrent(account)
  if (!response.ok) throw new Error('Could not load export instructions')
  const text = await response.text()
  const selected = await dialog.showSaveDialog({
    title: 'Save Grok Bot export skill',
    defaultPath: 'SKILL.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })

  if (selected.canceled || !selected.filePath) return
  await writeFile(selected.filePath, text, { mode: 0o600 })
}
