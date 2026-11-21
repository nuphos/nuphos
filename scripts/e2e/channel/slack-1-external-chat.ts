// #3702: a Slack channel is an external chat. Each person's message reaches the Bot through a
// hidden record no listing shows, and only the owner, known by their email in this workspace,
// speaks for them: a Slack Connect outsider with that email and an unlinked member are data.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'

import { artifacts, until } from '../processes.ts'
import { joinTeam } from '../dashboard-scenarios.ts'
import { addSlackUser, sealSlackToken, sendSlackEvent, slackPosts } from '../slack-stub.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

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

/** Opens Slack's settings in light, with the connected channel's Bot shown, and shoots them. */
async function shootSettings(page: Page, file: string, bot: string) {
  // The app read its connectors at start, before the scenario installed Slack.
  await page.reload()
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.getByRole('button', { name: 'Connectors', exact: true }).click()
  await page
    .getByRole('button', { name: /^Open Slack/ })
    .first()
    .click()
  // Not exact: once loaded, the heading also holds the channel count.
  const channels = page.getByText('Connected channels').first()

  await channels.waitFor()
  await page.getByText(bot, { exact: true }).first().waitFor()
  // The dialog scrolls its own body: bring the channel list to its top.
  await channels.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${artifacts}/${file}` })
}

/** One call to the Slack settings API as the e2e user, a team admin who owns the E2E Bot. */
async function settings(
  stack: Stack,
  method: string,
  path: string,
  body?: object,
  token = stack.token,
) {
  const query = body ? '' : `${path.includes('?') ? '&' : '?'}teamId=${stack.teamId}`
  const response = await fetch(`${stack.apiUrl}${path}${query}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify({ teamId: stack.teamId, ...body }) } : {}),
  })

  if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

  return (await response.json()) as unknown
}

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
  // The teammate's Bot, refused while the viewer's holds the channel.
  expected: /"error_code":"slack_channel_has_bot"/,
  run: async (page, stack) => {
    addSlackUser('UOWNER', { team_id: WORKSPACE, email: stack.email, name: 'Owner in Slack' })
    addSlackUser('UEXT', { team_id: 'TOTHER', email: stack.email, name: 'Outsider' })
    addSlackUser('UNEW', { team_id: WORKSPACE, email: 'stranger@example.com', name: 'Stranger' })
    // The workspace's installation, as OAuth would store it.
    const created = mongo(
      stack,
      `const done = await db.collection('team_byos_bindings').updateOne(
        { _id: new ObjectId(args.teamId) },
        { $push: { slackWorkspaces: { id: new ObjectId(), slackTeamId: args.workspace,
          slackTeamName: 'E2E', botUserId: 'UE2EBOT', encryptedBotToken: args.token,
          installerSlackUserId: null, scope: '', createdAt: new Date() } } },
        { upsert: true })
      return Boolean(done.upsertedId)`,
      { workspace: WORKSPACE, teamId: stack.teamId, token: sealSlackToken('xoxb-e2e') },
    ) as boolean
    // The settings, as an admin and then the Bot's owner use them: connect, then bring the Bot.
    const { mapping } = (await settings(stack, 'PUT', '/slack/mappings', {
      slackWorkspaceId: WORKSPACE,
      slackChannelId: CHANNEL,
    })) as { mapping: { externalChatId: string } }
    const chatId = mapping.externalChatId
    const { myBots } = (await settings(stack, 'GET', '/slack/mappings')) as {
      myBots: { sessionId: string; title?: string }[]
    }
    const bot = myBots.find((candidate) => candidate.title === 'E2E Bot')

    if (!bot) throw new Error('The settings do not offer the E2E Bot')
    await settings(stack, 'POST', `/slack/mappings/${WORKSPACE}/${CHANNEL}/bots`, {
      botSessionId: bot.sessionId,
    })

    // An agent's scoped token can manage the same channel only in its own team.
    const me = (await (
      await fetch(`${stack.apiUrl}/auth/me`, {
        headers: { authorization: `Bearer ${stack.token}` },
      })
    ).json()) as { id: string }
    const sign = (claims: object) => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const signature = createHmac('sha256', 'local-e2e-jwt-secret-not-a-production-credential')
        .update(`${header}.${payload}`)
        .digest('base64url')
      return `${header}.${payload}.${signature}`
    }
    const claims = {
      aud: 'nuphos-preview-mcp',
      sub: me.id,
      own: me.id,
      sid: bot.sessionId,
      tid: stack.teamId,
      ori: stack.apiUrl,
      exp: Math.floor(Date.now() / 1000) + 600,
    }
    const conversationToken = sign(claims)
    const callAsAgent = (path: string, method = 'GET', body?: object, token = conversationToken) =>
      fetch(`${stack.apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const teamPath = `/teams/${stack.teamId}/slack/mappings`
    if ((await callAsAgent(teamPath)).status !== 200)
      throw new Error('Conversation cannot list Slack mappings')
    if (
      (await callAsAgent(teamPath, 'PUT', { slackWorkspaceId: WORKSPACE, slackChannelId: CHANNEL }))
        .status !== 200
    )
      throw new Error('Conversation cannot connect a Slack channel')
    if (
      (
        await callAsAgent(`${teamPath}/${WORKSPACE}/${CHANNEL}/bots`, 'POST', {
          botSessionId: bot.sessionId,
        })
      ).status !== 200
    )
      throw new Error('Conversation cannot assign its owner’s Bot')
    if ((await callAsAgent('/teams/64b000000000000000000001/slack/mappings')).status !== 403)
      throw new Error('Conversation reached another team')
    if (
      (await callAsAgent(teamPath, 'GET', undefined, sign({ ...claims, lim: {} }))).status !== 403
    )
      throw new Error('Credential-limited token reached Slack mappings')

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
      // The settings screen as Yuanlin reviews it, in light: one Bot per channel. The
      // viewer has a spare Bot, so the picker shows, closed while their own Bot is there.
      await settings(stack, 'POST', '/agent/bots', { title: 'Spare Bot', avatar: '02-leonardo' })
      await shootSettings(page, 'slack-settings-admin-channels-light.png', 'E2E Bot')
      // The channel's Bot is one choice: the viewer's Bots, or none.
      await page.getByLabel('Bot for this channel').first().click()
      await page.getByRole('option', { name: 'No Bot' }).waitFor()
      await page.screenshot({ path: `${artifacts}/slack-settings-admin-picker-light.png` })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Connect a channel' }).click()
      await page.getByText('Link by ID', { exact: true }).waitFor()
      // The form ends below the list: bring its last row to the dialog's bottom.
      await page
        .getByRole('button', { name: 'Link channel' })
        .evaluate((element) => element.scrollIntoView({ block: 'end' }))
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${artifacts}/slack-settings-admin-connect-light.png` })
      // A teammate's Bot waits while the viewer's is there, and comes in once it is out.
      const teammate = await joinTeam(stack, 'slack-teammate')

      mongo(
        stack,
        `await db.collection('users').updateOne({ _id: new ObjectId(args.id) }, { $set: { name: 'Mei' } })`,
        { id: teammate.id },
      )
      const theirs = (await settings(
        stack,
        'POST',
        '/agent/bots',
        { title: 'Mei Bot', avatar: '05-rembrandt' },
        teammate.token,
      )) as { sessionId: string }
      const bringTheirs = () =>
        settings(
          stack,
          'POST',
          `/slack/mappings/${WORKSPACE}/${CHANNEL}/bots`,
          { botSessionId: theirs.sessionId },
          teammate.token,
        )
      const refused = await bringTheirs().then(
        () => 'answered 200',
        (error: unknown) => String(error),
      )

      if (!refused.endsWith('answered 409'))
        throw new Error(`A second Bot came into the channel: ${refused}`)
      await settings(
        stack,
        'DELETE',
        `/slack/mappings/${WORKSPACE}/${CHANNEL}/bots/${bot.sessionId}`,
      )
      await bringTheirs()
      // The same screen for a member: the viewer's role, as the team stores it, set to member.
      const me = ((await settings(stack, 'GET', '/auth/me')) as { id: string }).id
      // Sets the viewer's stored role and answers the one it replaced.
      const role = (to: string) =>
        mongo(
          stack,
          `const team = { _id: new ObjectId(args.teamId) }
          const before = (await db.collection('teams').findOne(team)).members.find((m) => String(m.userId) === args.userId).role
          await db.collection('teams').updateOne({ ...team, 'members.userId': new ObjectId(args.userId) }, { $set: { 'members.$.role': args.role } })
          return before`,
          { teamId: stack.teamId, userId: me, role: to },
        ) as string
      const admin = role('MEMBER')

      try {
        await shootSettings(page, 'slack-settings-member-light.png', 'Mei Bot')
        if ((await page.getByRole('button', { name: 'Connect a channel' }).count()) > 0)
          throw new Error('A member is offered to connect a channel')
      } finally {
        role(admin)
        await page.reload()
      }
    } finally {
      await settings(stack, 'DELETE', `/slack/mappings/${WORKSPACE}/${CHANNEL}`)
      mongo(
        stack,
        `await db.collection('agent_conversations').deleteOne({ sessionId: args.chatId })
        await db.collection('agent_messages').deleteMany({ sessionId: args.chatId })
        const team = { _id: new ObjectId(args.teamId) }
        if (args.created) await db.collection('team_byos_bindings').deleteOne(team)
        else await db.collection('team_byos_bindings').updateOne(team, { $pull: { slackWorkspaces: { slackTeamId: args.workspace } } })`,
        { teamId: stack.teamId, workspace: WORKSPACE, created, chatId },
      )
    }
  },
} satisfies Scenario
