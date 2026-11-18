// What a turn's reported usage becomes in the database, read back as the usage views read it.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { artifacts, until } from './processes.ts'
import { newTask, openComputers, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

type TurnRow = { modelId: string; tokens: Record<string, number> } & Record<string, unknown>

/** The step_total rows of runtime turns, or null before any is written. */
function turnRows(stack: Stack): TurnRow[] | null {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const rows = await client.db('nuphos_e2e').collection('agent_token_usage')
      .find({ teamId, source: 'agent-runtime', kind: 'step_total' }).toArray()
    await client.close()
    console.log(JSON.stringify(rows.length ? rows : null))`

  return JSON.parse(
    execFileSync('bun', ['-e', script, stack.mongoUri, stack.teamId], {
      cwd: BACKEND_DIR,
      timeout: 10_000,
    }).toString(),
  ) as TurnRow[] | null
}

/** Adds (or removes) one usage row for each of 5,001 models, more groups than a usage query reads. */
function tooManyModels(stack: Stack, add: boolean) {
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

/** JSON with every object's keys in order, so two values compare as text. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )

export const usageScenarios: Scenario[] = [
  {
    name: 'before any usage, the Computers page says so, dims while loading, and retries a failed read',
    run: async (page, stack) => {
      await openComputers(page)
      const section = page.getByRole('region', { name: 'Token usage' })

      await section.getByText('No token usage recorded in this range yet.').waitFor()
      await section.scrollIntoViewIfNeeded()
      await section.screenshot({ path: `${artifacts}/token-usage-empty.png` })

      // A range the app has not read yet, while the backend cannot answer: the last one stays, dimmed.
      await stack.freezeBackend(async () => {
        await section.getByRole('radio', { name: '90d' }).click()
        await section.locator('[aria-busy="true"]').waitFor()
        await section.screenshot({ path: `${artifacts}/token-usage-loading.png` })
      })
      await section.locator('[aria-busy="false"]').waitFor()

      // More models than a query may group: the backend refuses it, and the page says so.
      tooManyModels(stack, true)
      try {
        await section.getByRole('radio', { name: '30d' }).click()
        await section.getByRole('alert').getByText('Couldn’t load token usage.').waitFor()
        await section.screenshot({ path: `${artifacts}/token-usage-error.png` })
      } finally {
        tooManyModels(stack, false)
      }
      await section.getByRole('button', { name: 'Try again' }).click()
      await section.getByText('No token usage recorded in this range yet.').waitFor()
      await section.getByRole('radio', { name: '7d' }).click()
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
  {
    name: 'a Claude Code turn is stored per model with its sender, runtime and stop reason',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Count this E2E_TURN_USAGE E2E_DELIVERY:usage')
      await page.getByText('ACK E2E_DELIVERY:usage').waitFor()
      let rows: TurnRow[] | null = null

      await until('the turn usage to be stored', async () => {
        rows = turnRows(stack)

        return rows !== null
      })
      const byModel = Object.fromEntries((rows ?? []).map((row) => [row.modelId, row.tokens]))
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
      // The app's own member sent it, on the stack's hosted runtime, and it ended normally.
      for (const row of rows ?? [])
        if (
          row.actorUserId !== row.userId ||
          row.turnSource !== 'app' ||
          typeof row.runtimeId !== 'string' ||
          row.finishReason !== 'end_turn'
        )
          throw new Error(`Turn row is missing who, where or how: ${JSON.stringify(row)}`)
    },
  },
  {
    name: 'the Computers page shows that turn’s tokens by model, then by runtime',
    run: async (page) => {
      await openComputers(page)
      const section = page.getByRole('region', { name: 'Token usage' })
      const table = section.getByRole('table', { name: 'Token usage by group' })

      await table.getByText('claude-opus-5-5').waitFor()
      await table.getByText('claude-haiku-5-5').waitFor()
      // Input includes the cache, so the total is input + output.
      await table.getByText('258.9K').waitFor()
      await section.scrollIntoViewIfNeeded()
      await section.screenshot({ path: `${artifacts}/token-usage-by-model.png` })

      await section.getByRole('combobox', { name: 'Group by' }).click()
      await page.getByRole('option', { name: 'Runtime' }).click()
      // Both models ran on the stack's one runtime, shown by its name rather than its id.
      await table.getByText('290.3K').waitFor()
      if ((await table.getByText('Not recorded').count()) > 0)
        throw new Error('A runtime turn was not attributed to its runtime')
      await section.screenshot({ path: `${artifacts}/token-usage-by-runtime.png` })
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
]
