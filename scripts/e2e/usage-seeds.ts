// Usage written straight to the database, for what a real turn cannot produce in a test.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import type { Stack } from './stack.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Adds (or removes) one usage row for each of 5,001 models, more groups than a usage query reads. */
export function tooManyModels(stack: Stack, add: boolean) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId, add] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const usage = client.db('nuphos_e2e').collection('agent_token_usage')
    if (add === 'true')
      await usage.insertMany(Array.from({ length: 5001 }, (_, n) => ({
        recordId: 'e2e-many-' + n, sessionId: 'e2e-many', userId: 'e2e-many', teamId,
        operation: 'agent.turn', source: 'agent-runtime', kind: 'step_total',
        accounting: 'upstream_reported', provider: 'e2e', modelId: 'e2e-model-' + n,
        tokens: { totalTokens: 1 }, createdAt: new Date(),
      })))
    else await usage.deleteMany({ teamId, sessionId: 'e2e-many' })
    await client.close()`

  execFileSync('bun', ['-e', script, stack.mongoUri, stack.teamId, String(add)], {
    cwd: BACKEND_DIR,
    timeout: 20_000,
  })
}

type Seed = { actor: string; total: number; daysAgo: number; triggerId?: string }

/** Writes (or, with no seeds, removes) usage a turn would record, in `sessionId`, owned by its owner. */
export function seedUsage(stack: Stack, sessionId: string, owner: string, seeds: Seed[]) {
  const script = `
    import { MongoClient, ObjectId } from 'mongodb'
    const [uri, teamId, sessionId, owner, seeds] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const usage = client.db('nuphos_e2e').collection('agent_token_usage')
    const parsed = JSON.parse(seeds)
    if (parsed.length === 0) await usage.deleteMany({ teamId, operation: 'e2e.seed' })
    else
      await usage.insertMany(parsed.flatMap((seed) => {
        const base = {
          sessionId, userId: owner, actorUserId: seed.actor, teamId, operation: 'e2e.seed',
          source: 'agent-runtime', accounting: 'upstream_reported', provider: 'claude-code',
          modelId: 'claude-opus-5-5', turnSource: seed.triggerId ? 'agent.trigger' : 'app',
          createdAt: new Date(Date.now() - seed.daysAgo * 86400000),
          ...(seed.triggerId ? { triggerId: seed.triggerId } : {}),
        }
        const row = (kind, tokens) => ({ ...base, recordId: new ObjectId().toHexString(), kind, tokens })
        return [
          row('step_total', { totalTokens: seed.total }),
          row('input', { inputTokens: seed.total - 1000 }),
          row('output', { outputTokens: 1000 }),
        ]
      }))
    await client.close()`

  execFileSync(
    'bun',
    ['-e', script, stack.mongoUri, stack.teamId, sessionId, owner, JSON.stringify(seeds)],
    { cwd: BACKEND_DIR, timeout: 20_000 },
  )
}
