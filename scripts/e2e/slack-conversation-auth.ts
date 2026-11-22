import { createHmac } from 'node:crypto'

import { E2E_JWT_SECRET } from './slack-stub.ts'

import type { Stack } from './stack.ts'

export async function verifyConversationMapping(
  stack: Stack,
  botSessionId: string,
  workspace: string,
  channel: string,
) {
  // An agent's scoped token can manage the same channel only in its own team.
  const me = (await (
    await fetch(`${stack.apiUrl}/auth/me`, {
      headers: { authorization: `Bearer ${stack.token}` },
    })
  ).json()) as { id: string }
  const sign = (claims: object) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signature = createHmac('sha256', E2E_JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url')

    return `${header}.${payload}.${signature}`
  }
  const claims = {
    aud: 'nuphos-preview-mcp',
    sub: me.id,
    own: me.id,
    sid: botSessionId,
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
    (await callAsAgent(teamPath, 'PUT', { slackWorkspaceId: workspace, slackChannelId: channel }))
      .status !== 200
  )
    throw new Error('Conversation cannot connect a Slack channel')
  if (
    (
      await callAsAgent(`${teamPath}/${workspace}/${channel}/bots`, 'POST', {
        botSessionId,
      })
    ).status !== 200
  )
    throw new Error('Conversation cannot assign its owner’s Bot')
  if ((await callAsAgent('/teams/64b000000000000000000001/slack/mappings')).status !== 403)
    throw new Error('Conversation reached another team')
  if ((await callAsAgent(teamPath, 'GET', undefined, sign({ ...claims, lim: {} }))).status !== 403)
    throw new Error('Credential-limited token reached Slack mappings')
}
