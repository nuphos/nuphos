import { api } from '../../../api'
import { rememberOnboardingConnectors } from '../../../components/channels/onboardingConnectors'
import { locale } from '../../../i18n'

import { withTimeout } from './starterSelection'
import { connectableTools } from './tools'

import type { StarterRuntime } from './starterSelection'
import type { TourTool } from './tools'
import type { BotImportTarget, StarterBotOptions } from '../../../api/bot-import-types'

const key = 'nuphos-guide'
/** How long the import (preview, then apply) and then the face each get before Retry shows. */
const IMPORT_MS = 180_000
const AVATAR_MS = 30_000
/** An import still running after its timeout, which a retry waits on instead of starting again. */
const importing = new Map<string, Promise<{ sessionId: string; privateChatId: string }>>()

/**
 * Imports Nubie onto the chosen runtime under the chosen name and face, and
 * returns its private chat. The chat then offers to connect the picked tools.
 */
export async function createStarterBot({
  teamId,
  runtime,
  name,
  avatar,
  picks,
}: {
  teamId: string
  runtime: StarterRuntime
  name: string
  /** A face's name, e.g. "14-napoleon". */
  avatar: string
  picks: readonly TourTool[]
}): Promise<string> {
  const target = { teamId, ...runtime }
  const slot = `${teamId}/${runtime.runtimeId}`
  const running =
    importing.get(slot) ??
    importStarterBot(target, {
      name,
      locale,
      // As on iOS: only the tools the chat can offer a Connect button for.
      connectorNames: connectableTools(picks),
    })

  importing.set(slot, running)
  void running.then(
    () => importing.delete(slot),
    () => importing.delete(slot),
  )
  const bot = await withTimeout(running, IMPORT_MS)

  await withTimeout(api.agentSetConversationAvatar(bot.sessionId, avatar, teamId), AVATAR_MS)
  rememberOnboardingConnectors(bot.privateChatId, connectableTools(picks))

  return bot.privateChatId
}

// A retry after the import applied finds it applied and goes on from there.
async function importStarterBot(
  target: BotImportTarget,
  options: StarterBotOptions,
): Promise<{ sessionId: string; privateChatId: string }> {
  const preview = await api.agentPreviewStarterBot(target, options)
  const result = preview.items.some((item) => item.key === key && item.state === 'applied')
    ? preview
    : await api.agentApplyBotImport(target, preview.id, {
        botKeys: [key],
        chatKeys: [],
        enableSchedules: false,
        scheduleActivationConfirmed: false,
      })
  const bot = result.items.find((item) => item.key === key)

  if (bot?.state !== 'applied' || !bot.privateChatId) throw new Error('Bot setup incomplete')

  return { sessionId: bot.sessionId, privateChatId: bot.privateChatId }
}

/** "09-frida" is Frida; "22-lady-with-an-ermine" is Lady with an Ermine. */
export function defaultBotName(face: string): string {
  const small = new Set(['of', 'the', 'with', 'an', 'a'])

  return face
    .split('-')
    .slice(1)
    .map((word, index) =>
      index > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')
}
