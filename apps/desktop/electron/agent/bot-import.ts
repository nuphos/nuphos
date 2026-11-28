import { open, writeFile } from 'node:fs/promises'

import { dialog } from 'electron'
import { strToU8, zipSync } from 'fflate'

import { accountSignal, stillCurrent } from '../account-request'

import { agentAccount, callJson } from './http'
import nubie from './nubie-onboarding.json'
import { starterGreeting } from './starter-greeting'
import { starterInstructions } from './starter-instructions'

import type {
  BotImportPreview,
  BotImportSelection,
  BotImportTarget,
  StarterBotOptions,
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

  return previewBotImport(target, bytes, newCopy)
}

export function previewStarterBot(target: BotImportTarget, options: StarterBotOptions) {
  const [template] = nubie.bots
  const manifest = {
    ...nubie,
    bots: [
      {
        ...template,
        name: options.name,
        greeting: starterGreeting(options.locale, options.connectorNames, target.agentRuntime),
        // Decided by where it was actually placed; the screen never says.
        instructions: starterInstructions({
          locale: options.locale,
          connectorNames: options.connectorNames,
          agentRuntime: target.agentRuntime,
          template: template.instructions,
        }),
      },
    ],
  }
  const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })

  return previewBotImport(target, bytes, false)
}

async function previewBotImport(target: BotImportTarget, bytes: Uint8Array, newCopy: boolean) {
  const account = await agentAccount()
  const copyQuery = newCopy ? `&copyId=${crypto.randomUUID()}` : ''
  const route = `/agent/bot-imports/preview${query(target)}${copyQuery}`
  const response = await fetch(`${account.api}${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/zip' },
    signal: accountSignal(account, 120_000),
    body: Uint8Array.from(bytes),
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
  return callJson<BotImportPreview>(
    'POST',
    `/agent/bot-imports/${encodeURIComponent(id)}/apply${query(target)}`,
    selection,
    120_000,
  )
}

export function getBotImportStatus(target: BotImportTarget, id: string) {
  return callJson<BotImportPreview>(
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
