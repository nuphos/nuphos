// What a turn's reported usage becomes in the database, read back as the usage views read it.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { api, joinTeam } from './dashboard-scenarios.ts'
import { until } from './processes.ts'
import { teamActivityScenarios } from './team-activity-scenarios.ts'
import { newTask, openComputers, send } from './ui.ts'
import { captureFilterMenu, checkNamesByRole, computersAndPrivate, shot } from './usage-checks.ts'
import {
  privateConversation,
  seedCaptureExtras,
  seedTenfold,
  seedUsage,
  tooManyModels,
} from './usage-seeds.ts'

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
      // Rows from before cached tokens were recorded in input are left as they are, and say so.
      await section.getByText(/Input left out cached tokens; Total included them/).waitFor()
      await shot(section, 'token-usage-empty')

      // A range the app has not read yet, while the backend cannot answer: the last one stays, dimmed.
      await stack.freezeBackend(async () => {
        await section.getByRole('radio', { name: '90d' }).click()
        await section.locator('[aria-busy="true"]').waitFor()
        await shot(section, 'token-usage-loading')
      })
      await section.locator('[aria-busy="false"]').waitFor()

      // More models than a query may group: the backend refuses it, and the page says so.
      tooManyModels(stack, true)
      try {
        await section.getByRole('radio', { name: '30d' }).click()
        await section.getByRole('alert').getByText('Couldn’t load token usage.').waitFor()
        await shot(section, 'token-usage-error')
      } finally {
        tooManyModels(stack, false)
      }
      await section.getByRole('button', { name: 'Try again' }).click()
      await section.getByText('No token usage recorded in this range yet.').waitFor()
      await section.getByRole('radio', { name: '7d' }).click()
      await page.getByText('Back to app', { exact: true }).click()
    },
    // The read it refuses on purpose: more groups than a usage query may build.
    expected: /\/usage\/query".*"status":400/,
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
      await shot(section, 'token-usage-by-model')

      await section.getByRole('combobox', { name: 'Group by' }).click()
      await page.getByRole('option', { name: 'Runtime' }).click()
      // Both models ran on the stack's one runtime, shown by its name rather than its id.
      await table.getByText('290.3K').waitFor()
      if ((await table.getByText('Not recorded').count()) > 0)
        throw new Error('A runtime turn was not attributed to its runtime')
      await shot(section, 'token-usage-by-runtime')

      // The backend names conversations by their titles, not their session ids.
      await section.getByRole('combobox', { name: 'Group by' }).click()
      await page.getByRole('option', { name: 'Task', exact: true }).click()
      await table.getByRole('columnheader', { name: 'Task', exact: true }).waitFor()
      await table.getByText('290.3K').waitFor()
      const label = await table.getByRole('row').nth(1).getByRole('cell').first().innerText()

      if (/^[0-9a-f-]{36}$/.test(label) || label === 'Not recorded')
        throw new Error(`The conversation shows as "${label}", not its title`)
      await shot(section, 'token-usage-by-conversation')
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
  {
    // Yuanlin's benchmark: why did usage jump this week, and who or what drove it, in two clicks.
    name: 'a teammate’s Trigger that grew tenfold ranks first, by member and then by Trigger',
    run: async (page, stack) => {
      const [turn] = turnRows(stack) ?? []

      if (!turn) throw new Error('The earlier turn left no usage row')
      const sessionId = String(turn.sessionId)
      const owner = String(turn.userId)
      const teammate = await joinTeam(stack, 'spender')
      const created = await api(stack, stack.token)('POST', '/agent/triggers', {
        teamId: stack.teamId,
        targetSessionId: sessionId,
        name: 'Nightly digest',
        triggerType: 'cron',
        cronExpression: '0 3 * * *',
        messageTemplate: 'Digest',
      })
      const triggerId = String((created.body as { id?: string }).id)

      const privateId = `e2e-private-${String(Date.now())}`

      seedTenfold(stack, { sessionId, privateId, owner, teammate: teammate.id, triggerId })
      try {
        await checkNamesByRole(stack, { sessionId, privateId, owner }, teammate.token)
        await openComputers(page)
        const section = page.getByRole('region', { name: 'Token usage' })
        const table = section.getByRole('table', { name: 'Token usage by group' })

        // Click one: by member, the teammate who grew is on top.
        await section.getByRole('combobox', { name: 'Group by' }).click()
        await page.getByRole('option', { name: 'Member' }).click()
        const top = table.getByRole('row').nth(1)

        await top.getByText('+3900%').waitFor()
        await top.getByText('400.0K').waitFor()
        // A person shows by name, even one who joined after the page first read the team.
        const person = await top.getByRole('cell').first().innerText()

        if (/^[0-9a-f]{24}$/.test(person)) throw new Error(`The teammate shows as id ${person}`)
        await shot(section, 'token-usage-why-1-member')

        // Click two: into that member, by Trigger, and the Trigger is named and new.
        await top.getByRole('button').click()
        await section.getByRole('button', { name: 'Clear filter' }).waitFor()
        await section.getByRole('combobox', { name: 'Group by' }).click()
        await page.getByRole('option', { name: 'Trigger' }).click()
        const trigger = table.getByRole('row').nth(1)

        await trigger.getByText('Nightly digest').waitFor()
        await trigger.getByText('New').waitFor()
        await shot(section, 'token-usage-why-2-trigger')

        await captureFilterMenu(page, section)
        await section.getByRole('button', { name: 'Clear filter' }).click()
        seedCaptureExtras(stack, teammate.id, owner, sessionId)
        await computersAndPrivate(page, section)
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        seedUsage(stack, sessionId, owner, [])
        privateConversation(stack, privateId, owner, false)
        await api(stack, stack.token)(
          'DELETE',
          `/agent/triggers/${triggerId}?teamId=${stack.teamId}`,
        )
      }
    },
  },
  // Who sees the team's activity and stats is read from the same members' numbers.
  ...teamActivityScenarios,
]
