// What a turn's reported usage becomes in the database, read back as the usage views read it.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Each model's step_total tokens from runtime turns, or null before any is written. */
function turnTokensByModel(stack: Stack): Record<string, Record<string, number>> | null {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const rows = await client.db('nuphos_e2e').collection('agent_token_usage')
      .find({ teamId, source: 'agent-runtime', kind: 'step_total' }).toArray()
    await client.close()
    console.log(JSON.stringify(rows.length ? Object.fromEntries(rows.map((row) => [row.modelId, row.tokens])) : null))`

  return JSON.parse(
    execFileSync('bun', ['-e', script, stack.mongoUri, stack.teamId], {
      cwd: BACKEND_DIR,
      timeout: 10_000,
    }).toString(),
  ) as Record<string, Record<string, number>> | null
}

/** JSON with every object's keys in order, so two values compare as text. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )

export const usageScenarios: Scenario[] = [
  {
    name: 'a Claude Code turn is stored per model, with its cache tokens and sub-agents counted',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Count this E2E_TURN_USAGE E2E_DELIVERY:usage')
      await page.getByText('ACK E2E_DELIVERY:usage').waitFor()
      let byModel: Record<string, Record<string, number>> | null = null

      await until('the turn usage to be stored', async () => {
        byModel = turnTokensByModel(stack)

        return byModel !== null
      })
      const expected = {
        'claude-opus-5-5': {
          inputTokens: 258_012,
          cachedInputTokens: 250_000,
          cacheWriteTokens: 8000,
          outputTokens: 900,
          totalTokens: 258_912,
        },
        'claude-haiku-5-5': {
          inputTokens: 31_000,
          cachedInputTokens: 30_000,
          cacheWriteTokens: 600,
          outputTokens: 400,
          totalTokens: 31_400,
        },
      }

      if (canonical(byModel) !== canonical(expected))
        throw new Error(`Stored ${JSON.stringify(byModel)}, expected ${JSON.stringify(expected)}`)
    },
  },
]
