// What a turn's reported usage becomes in the database, read back as the usage views read it.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** The newest runtime turn's step_total tokens, or null before one is written. */
function lastTurnTokens(stack: Stack): Record<string, number> | null {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const row = await client.db('nuphos_e2e').collection('agent_token_usage').findOne(
      { teamId, source: 'agent-runtime', kind: 'step_total' },
      { sort: { createdAt: -1 } },
    )
    await client.close()
    console.log(JSON.stringify(row?.tokens ?? null))`

  return JSON.parse(
    execFileSync('bun', ['-e', script, stack.mongoUri, stack.teamId], {
      cwd: BACKEND_DIR,
      timeout: 10_000,
    }).toString(),
  ) as Record<string, number> | null
}

const sorted = (value: object | null) => JSON.stringify(Object.entries(value ?? {}).sort())

export const usageScenarios: Scenario[] = [
  {
    name: "a Claude Code turn's cache reads and writes are counted in its stored usage",
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Count this E2E_TURN_USAGE E2E_DELIVERY:usage')
      await page.getByText('ACK E2E_DELIVERY:usage').waitFor()
      let tokens: Record<string, number> | null = null

      await until('the turn usage to be stored', async () => {
        tokens = lastTurnTokens(stack)

        return tokens !== null
      })
      const expected = {
        inputTokens: 258_012,
        cachedInputTokens: 250_000,
        cacheWriteTokens: 8000,
        outputTokens: 900,
        totalTokens: 258_912,
      }

      if (sorted(tokens) !== sorted(expected))
        throw new Error(`Stored ${JSON.stringify(tokens)}, expected ${JSON.stringify(expected)}`)
    },
  },
]
