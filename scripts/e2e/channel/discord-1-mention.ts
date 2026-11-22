// #2928: Discord reaches a real turn. A workspace admin enables a channel with a signed slash
// command; a linked member's mention there opens a thread, runs the agent and gets its answer;
// an unlinked member's mention is told to link first and starts nothing.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import {
  DISCORD_BOT,
  DISCORD_CHANNEL,
  DISCORD_GUILD,
  deliverDiscordMessage,
  discordGatewayReady,
  discordInteractionReplies,
  discordPosts,
  sendDiscordInteraction,
} from '../discord-stub.ts'
import { until } from '../processes.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')

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

/** Waits for a post in `channelId` (any, when not given) that has `text`. */
const posted = (text: string, channelId?: string) =>
  until(`Discord to get "${text}"`, async () =>
    discordPosts().find(
      (post) => post.content.includes(text) && (!channelId || post.channelId === channelId),
    ),
  )

export default {
  name: "a linked member's Discord mention runs a turn and its answer reaches the thread",
  run: async (_page, stack) => {
    await until('the backend to connect to the Discord Gateway', async () => discordGatewayReady())
    // The server's installation and the owner's link, as OAuth would store them.
    mongo(
      stack,
      `const user = await db.collection('users').findOne({ email: args.email })
      const now = new Date()
      await db.collection('discord_installations').insertOne({ guildId: args.guild,
        guildName: 'E2E', teamId: args.teamId, installerDiscordUserId: 'DOWNER',
        installerNuphosUserId: user._id.toHexString(), generation: 1, enabled: true,
        createdAt: now, updatedAt: now })
      await db.collection('discord_user_mappings').insertOne({ guildId: args.guild,
        discordUserId: 'DOWNER', teamId: args.teamId, nuphosUserId: user._id.toHexString(),
        enabled: true, createdAt: now, updatedAt: now })`,
      { email: stack.email, teamId: stack.teamId, guild: DISCORD_GUILD },
    )

    await sendDiscordInteraction(stack, {
      type: 2,
      // Manage Channels.
      member: { permissions: '16', user: { id: 'DOWNER' } },
      data: { name: 'nuphos', options: [{ type: 1, name: 'enable' }] },
    })
    await until('the enable command to answer', async () =>
      discordInteractionReplies().some((reply) =>
        reply.content?.includes('enabled in this channel'),
      ),
    )

    deliverDiscordMessage({
      id: '1900000000000000001',
      channelId: DISCORD_CHANNEL,
      authorId: 'DSTRANGER',
      content: `<@${DISCORD_BOT}> hello E2E_DELIVERY:discord-unlinked`,
      mentionsBot: true,
    })
    await posted('Link your Discord account first', DISCORD_CHANNEL)

    deliverDiscordMessage({
      id: '1900000000000000002',
      channelId: DISCORD_CHANNEL,
      authorId: 'DOWNER',
      content: `<@${DISCORD_BOT}> Status? E2E_DELIVERY:discord-mention`,
      mentionsBot: true,
    })
    // The answer goes to the thread the mention started, not the channel.
    await posted('ACK E2E_DELIVERY:discord-mention', 'T1900000000000000002')

    if (discordPosts().some((post) => post.content.includes('discord-unlinked')))
      throw new Error("The unlinked member's mention reached the agent")
  },
} satisfies Scenario
