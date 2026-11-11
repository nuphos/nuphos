import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '@/lib/errors'

import type { BotBundle } from './manifest'

export type ImportOwner = {
  userId: string
  teamId: string
  runtimeId: string
  agentRuntime: string
}
export type ImportItem = {
  key: string
  kind: 'bot' | 'chat'
  sessionId: string
  privateChatId?: string
  state: 'pending' | 'applied' | 'failed'
  warnings: string[]
  error?: string
  members?: string[]
  lead?: string
  deliveredFiles?: string[]
}
export type ImportBatch = ImportOwner & {
  id: string
  digest: string
  createdAt: Date
  expiresAt: Date
  manifest: BotBundle
  items: ImportItem[]
  avatars?: Record<string, string>
  selection?: ImportSelection
}

export type ImportSelection = {
  botKeys: string[]
  chatKeys: string[]
  enableSchedules: boolean
}

export class ImportScheduleFailure extends Error {
  constructor() {
    super('A schedule could not be imported. Check Trigger permissions and quota, then retry.')
  }
}

export function importBatchId(owner: ImportOwner, digest: string, copyId = ''): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        owner.userId,
        owner.teamId,
        owner.runtimeId,
        owner.agentRuntime,
        digest,
        copyId,
      ]),
    )
    .digest('hex')
}

export function newImportBatch(
  owner: ImportOwner,
  digest: string,
  manifest: BotBundle,
  copyId = '',
): ImportBatch {
  const now = new Date()

  return {
    ...owner,
    digest,
    manifest,
    id: importBatchId(owner, digest, copyId),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    items: [
      ...manifest.bots.map((bot) => ({ key: bot.key, kind: 'bot' as const })),
      ...manifest.chats.map((chat) => ({ key: chat.key, kind: 'chat' as const })),
    ].map((item) => ({
      ...item,
      sessionId: randomUUID(),
      ...(item.kind === 'bot' ? { privateChatId: randomUUID() } : {}),
      state: 'pending',
      warnings: [],
    })),
  }
}

export function assertImportOwner(batch: ImportBatch, owner: ImportOwner) {
  if (
    batch.userId !== owner.userId ||
    batch.teamId !== owner.teamId ||
    batch.runtimeId !== owner.runtimeId ||
    batch.agentRuntime !== owner.agentRuntime
  )
    throw new Error('Import batch not found for this destination')
}

export function assertImportSelection(batch: ImportBatch, selection: ImportSelection) {
  for (const [kind, keys] of [
    ['bot', selection.botKeys],
    ['chat', selection.chatKeys],
  ] as const) {
    if (
      keys.length !== new Set(keys).size ||
      keys.some((key) => !batch.items.some((item) => item.kind === kind && item.key === key))
    )
      throw new AppError(
        400,
        'invalid_import_selection',
        'Selection contains duplicate or unknown keys',
      )
  }
  if (selection.botKeys.length + selection.chatKeys.length === 0)
    throw new AppError(400, 'invalid_import_selection', 'Select at least one Bot or chat')
}

export type ImportOperations = {
  checkAccess(owner: ImportOwner): Promise<void>
  save(item: ImportItem): Promise<void>
  bot(
    source: BotBundle['bots'][number],
    item: ImportItem,
    enableSchedules: boolean,
  ): Promise<string[]>
  chat(
    source: BotBundle['chats'][number],
    item: ImportItem,
    members: string[],
    lead: string | undefined,
    enableSchedules: boolean,
  ): Promise<string[]>
}

/** Only orchestration lives here; adapters call the existing Nuphos services. */
export async function applyImportBatch(
  batch: ImportBatch,
  owner: ImportOwner,
  selection: ImportSelection,
  operations: ImportOperations,
) {
  assertImportOwner(batch, owner)
  assertImportSelection(batch, selection)
  await operations.checkAccess(owner)
  const selected = batch.items.filter((item) =>
    (item.kind === 'bot' ? selection.botKeys : selection.chatKeys).includes(item.key),
  )

  for (const item of selected) {
    if (item.state === 'applied' && item.kind === 'bot') continue
    await operations.checkAccess(owner)
    try {
      if (item.kind === 'bot') {
        const source = batch.manifest.bots.find((bot) => bot.key === item.key)!

        item.warnings = await operations.bot(source, item, selection.enableSchedules)
      } else {
        const source = batch.manifest.chats.find((chat) => chat.key === item.key)!
        const available = batch.items.filter(
          (bot) =>
            bot.kind === 'bot' && bot.state === 'applied' && selection.botKeys.includes(bot.key),
        )
        const mapping = new Map(available.map((bot) => [bot.key, bot.sessionId]))
        const members = source.members.flatMap((key) =>
          mapping.has(key) ? [mapping.get(key)!] : [],
        )

        if (!members.length) throw new Error('No selected members imported successfully')
        const lead = source.lead ? mapping.get(source.lead) : undefined
        const missing = source.members.length - members.length

        if (
          item.state === 'applied' &&
          JSON.stringify(item.members) === JSON.stringify(members) &&
          item.lead === lead
        )
          continue

        item.warnings = [
          ...(missing ? [`${missing} members were not imported`] : []),
          ...(source.lead && !lead ? ['The original lead was not imported'] : []),
          ...(await operations.chat(source, item, members, lead, selection.enableSchedules)),
        ]
        item.members = members
        item.lead = lead
      }
      item.state = 'applied'
      delete item.error
    } catch (error) {
      // Provider/system exceptions may contain host paths or credentials; never persist their raw text.
      item.state = 'failed'
      item.error =
        error instanceof ImportScheduleFailure
          ? error.message
          : 'This item could not finish importing. Retry after checking the destination.'
    }
    // If saving the receipt fails, stop. Side effects use the preallocated IDs on retry.
    await operations.save(item)
  }

  return selected
}
