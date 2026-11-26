// A template Bot's first words: a real turn that checks what it needs and says so
// in its private chat, with the template's fixed greeting kept for when no turn can.
import { postChannelMessage } from '@/lib/agent/channel-chat'
import { agentConversations, agentMessages, getConversationBySessionId } from '@/lib/agent/db'
import { systemSender } from '@/lib/agent/message-system-sender'
import { takeCreatedTriggers } from '@/lib/agent/pending-created-triggers'
import { logError } from '@/lib/observability'

import { greetingPost, stableId } from './greeting'

import type { ImportBatch, ImportItem } from './batch'
import type { ImportedBot } from './manifest'
import type { CreatedTrigger } from '@/lib/agent/message-created-triggers'

type Requirement = { provider: string; required: boolean; reason: string }

/** What the first turn is told: the greeting is a model, not a script. */
export function firstTurnPrompt(args: {
  chatId: string
  name: string
  greeting: string
  requirements: Requirement[]
  triggers: CreatedTrigger[]
}): string {
  const lines = [
    `You were just added to Nuphos as ${args.name}, from a template. Your owner is waiting in your private chat (channelId ${args.chatId}) for your first message; nothing has been said there yet.`,
    '',
    'Post that first message there with channel_post. Nobody is watching this turn, so channel_read and channel_post on that chat are the only tools you can use; do not call any other. Base it on this opening from the template, in the language your owner uses, and adapt it to what you find below:',
    '<template-greeting>',
    args.greeting,
    '</template-greeting>',
  ]

  if (args.requirements.length > 0) {
    lines.push(
      '',
      'Integrations this template uses:',
      ...args.requirements.map(
        (item) => `- ${item.provider} (${item.required ? 'required' : 'optional'}): ${item.reason}`,
      ),
      'In your post, say in one short line which required ones you need connected before you can do your work, and ask your owner to connect them. Leave optional ones out for now.',
    )
  }
  if (args.triggers.length > 0) {
    lines.push(
      '',
      `Routines set up for you, turned off until your owner turns them on: ${args.triggers.map((item) => item.name).join(', ')}. Mention them in one short sentence and ask whether to turn them on.`,
    )
  }
  lines.push(
    '',
    'Keep the post short. If the chat already has a message from you, do not post another.',
  )

  return lines.join('\n')
}

async function hasSpoken(chatId: string, botSessionId: string) {
  return Boolean(
    await agentMessages().findOne(
      { sessionId: chatId, 'metadata.sender.id': botSessionId },
      { projection: { _id: 1 } },
    ),
  )
}

/** The template's own greeting, posted once, for when the Bot did not speak itself. */
async function postFallback(
  batch: ImportBatch,
  item: ImportItem & { privateChatId: string },
  source: ImportedBot & { greeting: string },
) {
  const chat = await getConversationBySessionId(item.privateChatId)

  if (!chat || (await hasSpoken(item.privateChatId, item.sessionId))) return
  const triggers = await takeCreatedTriggers(item.privateChatId, item.sessionId)

  // A fixed id: a retried apply finds the greeting already posted.
  await postChannelMessage(
    chat,
    greetingPost(item, source.name, batch.agentRuntime, source.greeting, triggers),
    item.sessionId,
  )
}

/**
 * Wakes the new Bot for its first turn in its private chat, and posts the fixed
 * greeting instead when that turn cannot start or ends without a post there.
 * Returns once the turn is handed over; it runs on in the background.
 */
export async function startFirstTurn(
  batch: ImportBatch,
  item: ImportItem & { privateChatId: string },
  source: ImportedBot & { greeting: string },
  triggers: CreatedTrigger[],
): Promise<void> {
  const chatId = item.privateChatId

  if (await hasSpoken(chatId, item.sessionId)) return
  if (triggers.length > 0)
    await agentConversations().updateOne(
      { sessionId: chatId },
      { $set: { pendingCreatedTriggers: { botSessionId: item.sessionId, triggers } } },
    )
  const fallback = () =>
    postFallback(batch, item, source).catch((error: unknown) => {
      logError('agent.bot_import.greeting_failed', error, { session_id: item.sessionId })
    })

  try {
    const agent = await getConversationBySessionId(item.sessionId)

    if (!agent) throw new Error('Imported Bot not found')
    const { startConversationTurn } = await import('@/lib/agent/conversation-turn')
    const { status, run } = await startConversationTurn(
      {
        userId: batch.userId,
        teamId: batch.teamId,
        targetSessionId: item.sessionId,
        // Fixed per chat: a retried apply finds this turn already taken or queued.
        messageId: stableId(`bot-first-turn:${chatId}`),
        locale: agent.metadata?.locale ?? 'en-US',
        speaksIn: chatId,
      },
      agent,
      firstTurnPrompt({
        chatId,
        name: source.name,
        greeting: source.greeting,
        requirements: batch.manifest.requirements ?? [],
        triggers,
      }),
      'agent.resource',
      systemSender(`nuphos:bot-template:${item.sessionId}`, 'Nuphos'),
    )

    // A queued turn is a retry's, or waits behind another: it speaks when it runs.
    if (status === 'started') void run.catch(() => undefined).then(fallback)
  } catch (error) {
    logError('agent.bot_import.first_turn_failed', error, { session_id: item.sessionId })
    await fallback()
  }
}
