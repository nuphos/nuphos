// A teammate's Task shared with the signed-in person, on a computer of the teammate's.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { rest } from './leave-helpers.ts'

import type { Stack } from './stack.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Runs `script` against the database; it reads its arguments from process.argv. */
export function inDatabase(mongoUri: string, script: string, ...args: string[]) {
  const run = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    ${script}
    await client.close()`

  execFileSync('bun', ['-e', run, mongoUri, ...args], { cwd: BACKEND_DIR, timeout: 10_000 })
}

// The teammate's computer, online until the returned function is called. No agent runs turns
// on it, so a message sent while it is offline waits for it.
export async function laptopOnline(
  stack: Stack,
  token: string,
  deviceId: string,
): Promise<() => void> {
  await rest(stack, token)('PUT', '/agent/devices', {
    deviceId,
    label: `E2E ${deviceId}`,
    platform: 'darwin',
    allowLocalExec: true,
  })
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
    { headers: { authorization: `Bearer ${token}` } } as unknown as string[],
  )

  tunnel.addEventListener('message', () => tunnel.send(JSON.stringify({ t: 'pong' })))
  await new Promise((opened, failed) => {
    tunnel.addEventListener('open', opened)
    tunnel.addEventListener('error', failed)
  })
  tunnel.send(
    JSON.stringify({
      t: 'status',
      status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
    }),
  )

  return () => tunnel.close()
}

/** Puts the Task on the teammate's computer. The suite's agent is not theirs, so it is written. */
export function onLaptop(stack: Stack, sessionId: string, ownerId: string, deviceId: string) {
  inDatabase(
    stack.mongoUri,
    `await db.collection('agent_conversations').updateOne({ sessionId: process.argv[2] },
      { $set: { runtimeId: process.argv[3], runtimeLabel: 'Claude Code' } })`,
    sessionId,
    `local_${ownerId}_${deviceId}`,
  )
}

// A message, by default the signed-in person's. Taken before any computer runs it; offline, it waits.
export async function say(
  stack: Stack,
  sessionId: string,
  ownerToken: string,
  text: string,
  {
    as = stack.token,
    id = randomUUID(),
    mentions,
  }: { as?: string; id?: string; mentions?: string[] } = {},
) {
  const { messages } = await rest(stack, ownerToken)<{ messages: unknown[] }>(
    'GET',
    `/agent/conversations/${sessionId}?teamId=${stack.teamId}`,
  )
  const response = await fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: sessionId,
      teamId: stack.teamId,
      messages: [
        {
          id,
          role: 'user',
          parts: [{ type: 'text', text }],
          ...(mentions ? { metadata: { mentions } } : {}),
        },
      ],
      streamId: randomUUID(),
      baseIndex: messages.length,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  await response.body?.cancel()

  return response.status
}

/** The teammate's Task, written as the app syncs a transcript. */
export async function sharedTask(stack: Stack, ownerToken: string, title: string) {
  const sessionId = randomUUID()

  await rest(stack, ownerToken)('PUT', `/agent/conversations/${sessionId}/transcript`, {
    teamId: stack.teamId,
    title,
    messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: title }] }],
  })

  return sessionId
}

export const invite = (stack: Stack, ownerToken: string, sessionId: string, userId: string) =>
  rest(stack, ownerToken)('POST', `/agent/conversations/${sessionId}/participants`, {
    teamId: stack.teamId,
    userIds: [userId],
  })

/** The signed-in person's id. */
export async function myId(stack: Stack): Promise<string> {
  const me = await rest(stack, stack.token)<{ id?: string; user?: { id: string } }>(
    'GET',
    '/auth/me',
  )

  return me.user?.id ?? me.id ?? ''
}
