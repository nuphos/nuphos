// #4083: a Bot's instructions changed while its runtime session runs reach its next turn,
// and a turn with nothing changed keeps the running agent. Runs in the E2E Bot's chat.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentLog } from '../agent-log.ts'
import { openBotChat } from '../channel-quotes.ts'
import { until } from '../processes.ts'
import { send } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')

/** Sets the E2E Bot's instructions, the field `update_self` and the owner's edit write, and returns the old ones. */
function setInstructions(stack: Stack, instructions: string | null): string | null {
  const out = execFileSync(
    'bun',
    [
      '-e',
      `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    const bot = await bots.findOne({ title: 'E2E Bot', avatar: { $exists: true } })
    const next = JSON.parse(process.argv[2])
    await bots.updateOne({ _id: bot._id }, next === null ? { $unset: { instructions: '' } } : { $set: { instructions: next } })
    console.log(JSON.stringify(bot.instructions ?? null))
    await client.close()`,
      stack.mongoUri,
      JSON.stringify(instructions),
    ],
    { cwd: BACKEND_DIR, timeout: 10_000 },
  )

  return JSON.parse(out.toString()) as string | null
}

/** Sends a turn to the Bot and returns the rule its agent held then, from the latest of the
 *  system prompt it opened or loaded with and the updates its turns carried, and its session. */
async function askRule(stack: Stack, page: Parameters<Scenario['run']>[0], marker: string) {
  await send(page, `Which rule do you follow? E2E_DELIVERY:${marker}`)
  let log: ReturnType<typeof agentLog> = []
  let start = -1

  // Until the turn has finished: a Bot still at work reads busy to the scenarios after this one.
  await until(`the Bot to finish ${marker}`, async () => {
    log = agentLog(stack)
    start = log.findIndex(
      (line) => line.event === 'start' && line.marker === `E2E_DELIVERY:${marker}`,
    )

    return log.some((line) => line.event === 'finish' && line.marker === `E2E_DELIVERY:${marker}`)
  })
  const { sessionId } = log[start] ?? { sessionId: '' }
  const held = log
    .slice(0, start + 1)
    .findLast(
      (line) =>
        line.sessionId === sessionId &&
        (['session', 'loaded'].includes(line.event) || Boolean(line.update)),
    )

  return { rule: (held?.event === 'start' ? held.update : held?.rule) ?? 'none', sessionId }
}

/** How often the fixture agent opened or loaded this session. */
const opens = (stack: Stack, sessionId: string) =>
  agentLog(stack).filter(
    (line) => line.sessionId === sessionId && ['session', 'loaded'].includes(line.event),
  ).length

/** How many turns marked `marker` the fixture agent has finished. */
const finished = (stack: Stack, marker: string) =>
  agentLog(stack).filter((line) => line.event === 'finish' && line.marker === marker).length

/** The system prompt sections that differ between a session's last two opens or loads. */
function changedSections(stack: Stack, sessionId: string): string[] {
  const [before, after] = agentLog(stack)
    .filter((line) => line.sessionId === sessionId && ['session', 'loaded'].includes(line.event))
    .slice(-2)
    .map((line) => line.sections ?? [])

  return [...(before ?? []), ...(after ?? [])].filter(
    (section) => !before?.includes(section) || !after?.includes(section),
  )
}

const scenario: Scenario = {
  name: "a Bot's instructions changed mid-session reach its next turn; an unchanged turn keeps its agent",
  run: async (page, stack) => {
    const before = setInstructions(stack, 'Answer by the rule E2E_RULE:alpha.')

    try {
      await openBotChat(page)
      // The first turn after the change carries it to the running agent.
      const first = await askRule(stack, page, 'rule-alpha')

      if (first.rule !== 'alpha') throw new Error(`The Bot followed ${String(first.rule)}`)
      const opened = opens(stack, first.sessionId)
      // Nothing changed: the same agent answers, not reloaded.
      const again = await askRule(stack, page, 'rule-alpha-again')

      if (again.rule !== 'alpha' || again.sessionId !== first.sessionId)
        throw new Error(`An unchanged turn answered ${JSON.stringify(again)}`)
      if (opens(stack, first.sessionId) !== opened)
        throw new Error('A turn with the same instructions reloaded the agent')

      // The owner rewrites them while the session runs: the next turn follows the new ones,
      // which reach the running agent with that turn. Reloading would not: agents keep the
      // system prompt their session started with.
      setInstructions(stack, 'Answer by the rule E2E_RULE:beta.')
      const changed = await askRule(stack, page, 'rule-beta')

      if (changed.rule !== 'beta')
        throw new Error(`After the edit the Bot still followed ${String(changed.rule)}`)
      if (changed.sessionId !== first.sessionId)
        throw new Error('The edit started a new conversation instead of loading this one')
      if (opens(stack, first.sessionId) !== opened)
        throw new Error('The edit reloaded the agent instead of telling it in the turn')

      // A woken turn (an answer on its question card) between the person's own turns runs on the
      // same agent: nothing that changes from turn to turn is in its system prompt or env.
      const steady = opens(stack, first.sessionId)
      const answered = finished(stack, 'E2E_DELIVERY:answered')

      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:live-ask')
      await until(
        'the question to be asked',
        async () => finished(stack, 'E2E_DELIVERY:live-ask') > 0,
      )
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).last().click()
      await until(
        'the woken turn to finish',
        async () => finished(stack, 'E2E_DELIVERY:answered') > answered,
      )
      await askRule(stack, page, 'after-wake')
      if (opens(stack, first.sessionId) !== steady)
        throw new Error(
          `Alternating turns reloaded the agent; sections that changed: ${JSON.stringify(changedSections(stack, first.sessionId))}`,
        )
    } finally {
      setInstructions(stack, before)
    }
  },
}

export default scenario
