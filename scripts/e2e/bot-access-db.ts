// The Bot-access scenarios' reads and writes of the E2E database, where no route serves them.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import type { Stack } from './stack.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Runs a script against the E2E database; it prints one JSON line. */
function mongo(stack: Stack, script: string, ...args: string[]): unknown {
  const out = execFileSync('bun', ['-e', script, stack.mongoUri, ...args], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  }).toString()

  return out.trim() ? JSON.parse(out) : null
}

type StoredAccess = {
  awsRoleIds?: string[]
  deviceIds?: string[]
  resendIntegrationIds?: string[]
} | null

/** A Bot's stored credentialAccess, by its name; null until there is one. */
export function botNamed(stack: Stack, title: string) {
  return mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    const bot = await bots.findOne({ title: process.argv[2], avatar: { $exists: true } })
    console.log(bot ? JSON.stringify({ sessionId: bot.sessionId, access: bot.credentialAccess ?? null }) : '')
    await client.close()`,
    title,
  ) as { sessionId: string; access: StoredAccess } | null
}

/** Updates a Bot's record where no route does what a scenario needs. */
export function updateBot(stack: Stack, sessionId: string, update: object) {
  mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    await bots.updateOne({ sessionId: process.argv[2] }, JSON.parse(process.argv[3]))
    await client.close()`,
    sessionId,
    JSON.stringify(update),
  )
}
