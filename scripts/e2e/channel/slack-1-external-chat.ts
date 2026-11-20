// #3702: a Slack channel is an external chat. Each person's message reaches the Bot through a
// hidden record no listing shows, and only the owner, known by their email in this workspace,
// speaks for them: a Slack Connect outsider with that email and an unlinked member are data.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { until } from '../processes.ts'
import { addSlackUser, sealSlackToken, sendSlackEvent, slackPosts } from '../slack-stub.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')
const WORKSPACE = 'TE2E'
const CHANNEL = 'CE2E'

/** Runs `body` with `db` (the e2e database) and `args` (the JSON given); prints what it returns. */
function mongo(stack: Stack, body: string, args: unknown = null): unknown {
  const script = `
    import { MongoClient, ObjectId } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    const args = JSON.parse(process.argv[2])
    const result = await (async () => { ${body} })()
    console.log(JSON.stringify(result ?? null))
    await client.close()`
  const out = execFileSync('bun', ['-e', script, stack.mongoUri, JSON.stringify(args)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })

  return JSON.parse(out.toString()) as unknown
}

let events = 0

/** One person's Slack message in the connected channel, delivered as Slack signs it. */
async function slackMessage(stack: Stack, user: string, text: string, extra: object = {}) {
  const ts = `${String(1_800_000_000 + ++events)}.000100`

  await sendSlackEvent(stack, {
    type: 'event_callback',
    team_id: WORKSPACE,
    event_id: `EvE2E${String(events)}`,
    event: { type: 'message', channel: CHANNEL, user, ts, text, ...extra },
  })

  return ts
}

/** Waits for the Bot's answer in the external chat, as the database has it. */
async function answer(stack: Stack, chatId: string, text: string) {
  await until(`the Bot to answer "${text}"`, async () =>
    Boolean(
      mongo(
        stack,
        `return db.collection('agent_messages').findOne({ sessionId: args.chatId, 'parts.text': args.text }, { projection: { _id: 1 } })`,
        { chatId, text },
      ),
    ),
  )
}

export default {
  name: "a Slack channel's messages reach its Bot as an external chat, only the owner speaks for them, and the Bot answers in Slack",
  run: async (_page, stack) => {
    addSlackUser('UOWNER', { team_id: WORKSPACE, email: stack.email, name: 'Owner in Slack' })
    addSlackUser('UEXT', { team_id: 'TOTHER', email: stack.email, name: 'Outsider' })
    addSlackUser('UNEW', { team_id: WORKSPACE, email: 'stranger@example.com', name: 'Stranger' })
    // The record the settings will make for this channel: the E2E Bot's, and nobody's chat.
    const { chatId, created } = mongo(
      stack,
      `const bot = await db.collection('agent_conversations').findOne({ title: 'E2E Bot', avatar: { $exists: true } })
      const chatId = crypto.randomUUID()
      await db.collection('agent_conversations').insertOne({ sessionId: chatId, userId: bot.userId,
        teamId: args.teamId, kind: 'channel', external: 'slack', agentSessionIds: [bot.sessionId],
        title: '#e2e', firstMessage: '', messageCount: 0, createdAt: new Date(), lastActiveAt: new Date() })
      await db.collection('slack_channel_mappings').insertOne({ slackWorkspaceId: args.workspace,
        slackChannelId: args.channel, teamId: args.teamId, externalChatId: chatId, enabled: true,
        createdBy: 'e2e', createdAt: new Date(), updatedAt: new Date() })
      const done = await db.collection('team_byos_bindings').updateOne(
        { _id: new ObjectId(args.teamId) },
        { $push: { slackWorkspaces: { id: new ObjectId(), slackTeamId: args.workspace,
          slackTeamName: 'E2E', botUserId: 'UE2EBOT', encryptedBotToken: args.token,
          installerSlackUserId: null, scope: '', createdAt: new Date() } } },
        { upsert: true })
      return { chatId, created: Boolean(done.upsertedId) }`,
      {
        workspace: WORKSPACE,
        channel: CHANNEL,
        teamId: stack.teamId,
        token: sealSlackToken('xoxb-e2e'),
      },
    ) as { chatId: string; created: boolean }

    try {
      const asked = await slackMessage(stack, 'UOWNER', 'Status? E2E_WHO E2E_DELIVERY:slack-owner')

      await answer(stack, chatId, 'POSTED E2E_DELIVERY:slack-owner from=owner')
      // The answer is a Slack message in the channel, top-level, under the Bot's name.
      const said = slackPosts().find((post) => post.text?.includes('E2E_DELIVERY:slack-owner'))

      if (said?.channel !== CHANNEL || said.thread_ts || !said.text?.startsWith('*E2E Bot*'))
        throw new Error(`The Bot's answer reached Slack as ${JSON.stringify(said)}`)
      // Nothing of it shows in Nuphos, even to the Bot's owner with a matching search.
      const listing = await fetch(
        `${stack.apiUrl}/agent/conversations?teamId=${stack.teamId}&scope=team&kind=channel&search=e2e`,
        { headers: { authorization: `Bearer ${stack.token}` } },
      )
      const { conversations } = (await listing.json()) as { conversations: { sessionId: string }[] }

      if (!listing.ok || conversations.some((row) => row.sessionId === chatId))
        throw new Error('The external chat is listed in Nuphos')
      await slackMessage(stack, 'UEXT', 'Me too E2E_WHO E2E_DELIVERY:slack-ext', {
        user_team: 'TOTHER',
      })
      await answer(stack, chatId, 'POSTED E2E_DELIVERY:slack-ext from=data')
      await slackMessage(stack, 'UNEW', 'Hello E2E_WHO E2E_DELIVERY:slack-new')
      await answer(stack, chatId, 'POSTED E2E_DELIVERY:slack-new from=data')

      // Slack delivers the owner's message again, and as a mention: still one post.
      for (const type of ['message', 'app_mention'])
        await sendSlackEvent(stack, {
          type: 'event_callback',
          team_id: WORKSPACE,
          event_id: `EvE2Eagain-${type}`,
          event: { type, channel: CHANNEL, user: 'UOWNER', ts: asked, text: 'Status?' },
        })
      // A reply in the owner's Slack thread quotes it, and the Bot answers in that thread.
      const botPosts = () =>
        mongo(
          stack,
          `return db.collection('agent_messages').countDocuments({ sessionId: args.chatId, 'metadata.sender.type': 'agent' })`,
          { chatId },
        ) as number
      const before = botPosts()
      const reply = await slackMessage(stack, 'UNEW', 'Thread reply E2E_REPLY_TO', {
        thread_ts: asked,
      })

      await until('the Bot to answer the thread reply', async () => botPosts() > before)
      if (slackPosts().at(-1)?.thread_ts !== asked)
        throw new Error(`The Bot answered the thread at ${JSON.stringify(slackPosts().at(-1))}`)
      const stored = mongo(
        stack,
        `const messages = db.collection('agent_messages')
        return { asked: await messages.countDocuments({ messageId: args.asked }),
          replyTo: (await messages.findOne({ messageId: args.reply }))?.metadata?.replyTo?.id }`,
        { asked: `slack:${CHANNEL}:${asked}`, reply: `slack:${CHANNEL}:${reply}` },
      ) as { asked: number; replyTo?: string }

      if (stored.asked !== 1)
        throw new Error(`The owner's message was stored ${String(stored.asked)} times`)
      if (stored.replyTo !== `slack:${CHANNEL}:${asked}`)
        throw new Error(`The thread reply quotes ${String(stored.replyTo)}, not its root`)
    } finally {
      mongo(
        stack,
        `await db.collection('slack_channel_mappings').deleteOne({ slackChannelId: args.channel })
        await db.collection('agent_conversations').deleteOne({ sessionId: args.chatId })
        await db.collection('agent_messages').deleteMany({ sessionId: args.chatId })
        const team = { _id: new ObjectId(args.teamId) }
        if (args.created) await db.collection('team_byos_bindings').deleteOne(team)
        else await db.collection('team_byos_bindings').updateOne(team, { $pull: { slackWorkspaces: { slackTeamId: args.workspace } } })`,
        { channel: CHANNEL, teamId: stack.teamId, workspace: WORKSPACE, created, chatId },
      )
    }
  },
} satisfies Scenario
