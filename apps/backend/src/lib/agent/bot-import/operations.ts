import { createHash } from 'node:crypto'

import { createBot } from '@/lib/agent/bots'
import {
  agentConversations,
  getConversationBySessionId,
  updateBotSelf,
  upsertConversationShell,
} from '@/lib/agent/db'
import { addChannelAgent } from '@/lib/agent/db/channels'
import { getMemoryProvider } from '@/lib/agent/memory-slots'
import { personalSkillsScope, putSkillObjects } from '@/lib/agent/skill-store/service'
import { requireRuntimeInstance } from '@/lib/claude-code-preview/runtime-catalog'
import { isOpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import { isValidCronExpression } from '@/lib/cron'
import { storeAvatar } from '@/lib/identity/avatar-upload'
import { AppError } from '@/lib/errors'

import { ImportScheduleFailure } from './batch'
import { importedFileReferences, importBotFiles } from './files'

import type { BotBundleArchive } from './archive'
import type { ImportBatch, ImportItem, ImportOperations, ImportOwner } from './batch'
import type { ImportedBot, ImportedChat } from './manifest'

export async function checkImportDestination(owner: ImportOwner) {
  const runtime = await requireRuntimeInstance(owner.teamId, owner.runtimeId, owner.userId)

  if (
    runtime.status !== 'active' ||
    runtime.provider !== owner.agentRuntime ||
    runtime.notReady ||
    (runtime.local && !runtime.local.online)
  )
    throw new AppError(
      409,
      'import_destination_unavailable',
      'The selected agent is not currently available',
    )
  if (!isOpenAbProvider(owner.agentRuntime))
    throw new AppError(400, 'invalid_import_target', 'Unsupported destination agent')

  return runtime
}

async function saveFacts(batch: ImportBatch, item: ImportItem, memories: string[]) {
  const records = getMemoryProvider('native')?.records

  if (!records?.importFacts) throw new Error('Private memory import is unavailable')
  await records.importFacts({
    userId: batch.userId,
    teamId: batch.teamId,
    conversationId: item.sessionId,
    facts: memories,
  })
}

async function schedules(
  batch: ImportBatch,
  item: ImportItem,
  source: ImportedBot | ImportedChat,
  enabled: boolean,
) {
  const { createTrigger } = await import('@/lib/agent/trigger-service')
  const warnings = source.manualTasks.map((task) => `${task.name}: ${task.reason}`)

  for (const routine of source.schedules) {
    if (routine.schedule.kind !== 'cron' || !isValidCronExpression(routine.schedule.expression)) {
      warnings.push(`${routine.name}: this schedule requires manual setup`)
      continue
    }
    try {
      await createTrigger(
        {
          name: routine.name,
          triggerType: 'cron',
          cronExpression: routine.schedule.expression,
          timeZone: routine.timeZone,
          targetSessionId: item.sessionId,
          messageTemplate:
            'files' in source
              ? importedFileReferences(routine.prompt, source.files, item.sessionId)
              : routine.prompt,
          enabled: enabled && routine.requestedEnabled,
          dedupeKey: `bot-import:${batch.id}:${item.kind}:${item.key}:${routine.key}`,
        },
        { userId: batch.userId, teamId: batch.teamId, source: 'user' },
      )
    } catch {
      throw new ImportScheduleFailure()
    }
  }

  return warnings
}

async function skills(
  batch: ImportBatch,
  item: ImportItem,
  source: ImportedBot,
  archive: BotBundleArchive,
) {
  for (const skill of source.skills) {
    // Namespaced packages never replace an unrelated personal or team skill.
    const suffix = createHash('sha256')
      .update(`${batch.digest}:${source.key}:${skill.key}`)
      .digest('hex')
      .slice(0, 12)
    const name = `import-${skill.key.slice(0, 32)}-${suffix}`
    const prefix = `${skill.directory}/`
    const writes = [...archive.files]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, bytes]) => ({
        key: `skills/${name}/${path.slice(prefix.length)}`,
        body: Buffer.from(bytes),
        contentType: null,
      }))
    const mutationId = createHash('sha256')
      .update(`${batch.id}:${item.key}:${skill.key}`)
      .digest('hex')

    await putSkillObjects(personalSkillsScope(batch.teamId, batch.userId), writes, {
      mutationId,
      actor: { userId: batch.userId, source: 'import', conversationId: item.sessionId },
    })
  }
}

async function saveAvatar(
  batch: ImportBatch,
  item: ImportItem,
  source: ImportedBot,
  archive: BotBundleArchive,
) {
  if (!source.avatar) return
  const bytes = archive.files.get(source.avatar)
  const bot = await getConversationBySessionId(item.sessionId)

  if (!bytes || !bot?._id || bot.userId !== batch.userId || bot.teamId !== batch.teamId)
    throw new Error('Bot avatar destination not found')
  const avatar = await storeAvatar(bot._id.toHexString(), bytes)

  if (!(await updateBotSelf(item.sessionId, batch.userId, batch.teamId, { avatar })))
    throw new Error('Bot avatar could not be saved')
}

export function importOperations(
  batch: ImportBatch,
  archive: BotBundleArchive,
  save: ImportOperations['save'],
): ImportOperations {
  return {
    checkAccess: async (owner) => {
      await checkImportDestination(owner)
    },
    save,
    bot: async (source, item, enable) => {
      if (!isOpenAbProvider(batch.agentRuntime)) throw new Error('Unsupported destination')
      const existing = await getConversationBySessionId(item.sessionId)

      if (!existing)
        await createBot(
          batch.userId,
          batch.teamId,
          false,
          {
            title: source.name,
            runtimeId: batch.runtimeId,
            agentRuntime: batch.agentRuntime,
          },
          item.sessionId,
        )
      else if (existing.userId !== batch.userId || existing.teamId !== batch.teamId)
        throw new Error('Destination ownership changed')
      await updateBotSelf(item.sessionId, batch.userId, batch.teamId, {
        instructions: importedFileReferences(source.instructions, source.files, item.sessionId),
      })
      await saveAvatar(batch, item, source, archive)
      await skills(batch, item, source, archive)
      await saveFacts(batch, item, source.memories)
      await importBotFiles(batch, item, source, archive, save)
      const warnings = await schedules(batch, item, source, enable)

      if (item.privateChatId) {
        await upsertConversationShell({
          sessionId: item.privateChatId,
          userId: batch.userId,
          teamId: batch.teamId,
          title: '',
          firstMessage: '',
          kind: 'channel',
        })
        await addChannelAgent(item.privateChatId, item.sessionId)
      }

      return warnings
    },
    chat: async (source, item, members, lead, enable) => {
      const existing = await getConversationBySessionId(item.sessionId)

      if (
        existing &&
        (existing.userId !== batch.userId ||
          existing.teamId !== batch.teamId ||
          existing.kind !== 'channel')
      )
        throw new Error('Destination ownership changed')
      await upsertConversationShell({
        sessionId: item.sessionId,
        userId: batch.userId,
        teamId: batch.teamId,
        title: source.name,
        firstMessage: '',
        kind: 'channel',
      })
      for (const sessionId of members) await addChannelAgent(item.sessionId, sessionId)
      await agentConversations().updateOne(
        { sessionId: item.sessionId, userId: batch.userId, teamId: batch.teamId },
        {
          $set: {
            instructions: source.instructions,
            ...(lead ? { leadAgentSessionId: lead } : {}),
          },
          ...(!lead ? { $unset: { leadAgentSessionId: '' } } : {}),
        },
      )
      // Shared-chat summaries are placed in each imported member's private pool, never the team pool.
      for (const sessionId of members)
        await saveFacts(batch, { ...item, sessionId }, source.memories)

      // Scheduled prompts enter the channel through the ordinary channel delivery path.
      const selectedMembers = source.members.filter((key) => batch.selection?.botKeys.includes(key))
      const incomplete = members.length < selectedMembers.length || Boolean(source.lead && !lead)
      const warnings = incomplete
        ? ['Group schedules were not created because a selected member or lead is missing']
        : await schedules(batch, item, source, enable)

      return warnings
    },
  }
}
