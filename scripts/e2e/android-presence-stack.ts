// Real backend for Android's Bot presence device test (#3308): a Bot whose computer is offline,
// in its own chat and in a group chat with an online Bot. Writes what the test needs to `$E2E_ARTIFACTS/presence.json`,
// then keeps the stack up until `$E2E_ARTIFACTS/done` exists.
//   bun scripts/e2e/android-presence-stack.ts
// then, with `adb reverse tcp:<port> tcp:<port>`, run BotPresenceLiveDeviceTest with its arguments.
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { computerWithUsage } from './channel-helpers.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const stack = await startStack()
const api = async (method: string, path: string, body?: object) => {
  const response = await fetch(`${stack.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify({ teamId: stack.teamId, ...body }),
  })

  if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

  return (await response.json()) as Record<string, unknown>
}

// The phone app reads AI features only after its user accepted their terms (AccountApi.AI_CONSENT_VERSION).
const consent = await fetch(`${stack.apiUrl}/auth/ai-consent`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ version: '2026-09-28', accepted: true }),
})

if (!consent.ok) throw new Error(`Consent answered ${String(consent.status)}`)
const deviceId = randomUUID()
const disconnect = await computerWithUsage(stack, 'E2E away computer', deviceId)
type Runtime = { id: string; local?: { deviceId?: string } }
let runtime: Runtime | undefined

await until('the computer’s runtime', async () => {
  const listed = await api('GET', `/teams/${stack.teamId}/agent-runtimes`)

  runtime = (listed.runtimes as Runtime[]).find((row) => row.local?.deviceId === deviceId)

  return runtime
})
const bot = await api('POST', '/agent/bots', {
  title: 'Scribe',
  avatar: '07-ada',
  runtimeId: runtime?.id,
})
const botId = String(bot.sessionId)
// A second Bot on the stack's own agent host, which stays online.
const online = await api('POST', '/agent/bots', { title: 'Atlas', avatar: '02-leonardo' })
const chat = async (group: boolean, title: string, bots: unknown[]) => {
  const { sessionId } = await api('POST', '/agent/channels', { title, group })

  for (const agent of bots)
    await api('POST', `/agent/conversations/${String(sessionId)}/agents`, { sessionId: agent })

  return String(sessionId)
}
const botChat = await chat(false, '', [botId])
const groupChat = await chat(true, 'Launch planning', [botId, online.sessionId])
let userId = ''

disconnect(false)
await until('one Bot to read as offline and the other online', async () => {
  const { agents } = await api(
    'GET',
    `/agent/conversations/${groupChat}/agents?teamId=${stack.teamId}`,
  )
  const [away, here] = agents as { ownerId: string; presence?: { state: string; reason?: string } }[]

  userId = away?.ownerId ?? ''

  return away?.presence?.reason === 'computer_offline' && here?.presence?.state === 'online'
})
writeFileSync(
  join(artifacts, 'presence.json'),
  JSON.stringify({
    port: new URL(stack.apiUrl).port,
    token: stack.token,
    userId,
    teamId: stack.teamId,
    botId,
    botChat,
    groupChat,
  }),
)
console.log(`ready: ${join(artifacts, 'presence.json')}`)
await until('the device test to finish', async () => existsSync(join(artifacts, 'done')), 3_600_000)
stopAll()
process.exit(0)
