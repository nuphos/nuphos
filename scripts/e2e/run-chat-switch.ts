// `bun run e2e:chat-switch`: how fast a chat shows after its sidebar row is clicked, for Tasks
// and Bot chats, opened before or not since the app started, and how fast what was said while
// away shows. Writes chat-switch.json and chat-switch.md, and a recording of every switch.
import { appendFileSync, writeFileSync } from 'node:fs'

import { timeSwitch } from './chat-switch-timing.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { recordScreencast } from './screencast.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'
import { newTask, send } from './ui.ts'

import type { SwitchSample } from './chat-switch-timing.ts'
import type { Desktop } from './desktop.ts'
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

/** Budgets in ms at the median. `enforced` ones fail the run; the rest are reported until met. */
const BUDGETS = {
  'task, opened before': { history: 100, latest: 300, enforced: false },
  'bot chat, opened before': { history: 100, latest: 300, enforced: false },
  'bot chat, new post while away': { history: 100, latest: 300, enforced: false },
  'task, first open': { history: 400, latest: 700, enforced: false },
  'bot chat, first open': { history: 400, latest: 700, enforced: false },
  'task, first open, reply in progress': { history: 400, latest: 700, enforced: false },
} satisfies Record<string, { history: number; latest: number; enforced: boolean }>

type Case = keyof typeof BUDGETS

const ROUNDS = 5
const POSTS = 40
const samples = new Map<Case, SwitchSample[]>()

async function api(stack: Stack, path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${stack.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify({ teamId: stack.teamId, ...body }) }),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as Record<string, unknown>
}

/** A group chat with history, the same view as a Bot's chat. */
async function chat(stack: Stack, title: string) {
  const made = (await api(stack, '/agent/channels', { title, group: true })) as {
    sessionId: string
  }

  for (let n = 1; n <= POSTS; n++)
    await api(stack, `/agent/conversations/${made.sessionId}/channel-messages`, {
      text: `${title} post ${String(n)}`,
    })

  return made.sessionId
}

const named = new Set<string>()

/** A Task with one finished turn, named `title` so its row can be found. */
async function task(page: Page, stack: Stack, title: string, prompt: string, shows: string) {
  type Row = { sessionId: string; kind?: string; firstMessage?: string; title?: string }
  await newTask(page)
  await send(page, prompt)
  await page.getByText(shows).first().waitFor({ timeout: 60_000 })
  const { conversations } = (await api(
    stack,
    `/agent/conversations?teamId=${stack.teamId}&limit=200`,
  )) as { conversations: Row[] }
  const unnamed = conversations.filter((row) => row.kind !== 'channel' && !named.has(row.sessionId))
  const row =
    unnamed.find((row) => `${row.firstMessage ?? ''} ${row.title ?? ''}`.includes(prompt)) ??
    unnamed[0]

  if (!row) throw new Error(`No Task listed for "${prompt}"`)
  named.add(row.sessionId)
  await api(stack, `/agent/conversations/${row.sessionId}/title`, { title }, 'PATCH')
}

function row(page: Page, tab: 'Tasks' | 'Bots', title: string) {
  return page
    .getByRole('tabpanel', { name: tab })
    .locator('[data-sidebar-row]')
    .filter({ hasText: title })
    .first()
}

async function measure(
  page: Page,
  label: Case,
  tab: 'Tasks' | 'Bots',
  title: string,
  texts: { history: string; latest?: string },
) {
  await page.getByRole('tab', { name: tab }).click()
  const sample = await timeSwitch(page, row(page, tab, title), texts)

  samples.set(label, [...(samples.get(label) ?? []), sample])
  console.log(`${label}: ${JSON.stringify(sample)}`)
}

/** Back to a fresh renderer, as after starting the app: nothing opened, nothing cached. */
async function restart(page: Page) {
  // On a new Task, so the reloaded window restores no chat.
  await newTask(page)
  await page.reload()
  await page.getByRole('tab', { name: 'Tasks' }).waitFor()
}

const median = (values: (number | null)[]) => {
  const sorted = values.map((value) => value ?? Infinity).sort((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)] ?? Infinity
}

const ms = (value: number) => (Number.isFinite(value) ? `${String(value)} ms` : 'never')

function report(): string[] {
  const lines = [
    '| Switch | History, median | Newest, median | Spinner frames | Budget (history / newest) | Runs |',
    '| --- | --: | --: | --: | --- | --: |',
  ]
  const over: string[] = []

  for (const [label, budget] of Object.entries(BUDGETS) as [Case, (typeof BUDGETS)[Case]][]) {
    const runs = samples.get(label) ?? []
    const history = median(runs.map((run) => run.history))
    const latest = median(runs.map((run) => run.latest))
    const spinner = Math.max(0, ...runs.map((run) => run.spinnerFrames))
    const met = history <= budget.history && latest <= budget.latest
    let verdict = met ? 'met' : 'not yet'

    if (!met && budget.enforced) verdict = '**over**'
    lines.push(
      `| ${label} | ${ms(history)} | ${ms(latest)} | ${String(spinner)} | ${String(budget.history)} / ${String(budget.latest)} ms ${verdict} | ${String(runs.length)} |`,
    )
    if (!met && budget.enforced) over.push(label)
  }
  writeFileSync(
    `${artifacts}/chat-switch.json`,
    JSON.stringify(Object.fromEntries(samples), null, 2),
  )
  writeFileSync(`${artifacts}/chat-switch.md`, `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Chat switch\n\n${lines.join('\n')}\n`)

  return over
}

const lastPost = (title: string) => ({ history: `${title} post ${String(POSTS)}` })
const reply = (marker: string) => ({ history: `ACK E2E_DELIVERY:${marker}` })

async function scenario(page: Page, stack: Stack) {
  const chatA = 'Switch chat A'
  const chatB = 'Switch chat B'
  const taskA = 'Switch task A'
  const taskB = 'Switch task B'
  const taskLong = 'Switch task long'
  const chats = { [chatA]: await chat(stack, chatA), [chatB]: await chat(stack, chatB) }

  await task(page, stack, taskA, 'First task E2E_DELIVERY:switch-a', 'ACK E2E_DELIVERY:switch-a')
  await task(page, stack, taskB, 'Second task E2E_DELIVERY:switch-b', 'ACK E2E_DELIVERY:switch-b')
  // Its reply stays in progress for the rest of the run.
  await task(
    page,
    stack,
    taskLong,
    'Long task E2E_LONG E2E_HOLD E2E_DELIVERY:switch-long',
    'LONG_END',
  )

  await recordScreencast(page, 'chat-switch-frames', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await restart(page)
      await measure(page, 'task, first open', 'Tasks', taskA, reply('switch-a'))
      await measure(page, 'task, first open', 'Tasks', taskB, reply('switch-b'))
      await measure(page, 'task, first open, reply in progress', 'Tasks', taskLong, {
        history: 'Long task E2E_LONG',
        latest: 'LONG_END',
      })
      await measure(page, 'bot chat, first open', 'Bots', chatA, lastPost(chatA))
      await measure(page, 'bot chat, first open', 'Bots', chatB, lastPost(chatB))
      // Every one opened once now: the switches back and forth a person makes.
      await measure(page, 'task, opened before', 'Tasks', taskA, reply('switch-a'))
      await measure(page, 'task, opened before', 'Tasks', taskB, reply('switch-b'))
      await measure(page, 'bot chat, opened before', 'Bots', chatA, lastPost(chatA))
      await measure(page, 'bot chat, opened before', 'Bots', chatB, lastPost(chatB))
      // Said in chat A while chat B is on screen.
      const fresh = `${chatA} fresh ${String(round)}`

      await api(stack, `/agent/conversations/${chats[chatA]}/channel-messages`, { text: fresh })
      await measure(page, 'bot chat, new post while away', 'Bots', chatA, {
        ...lastPost(chatA),
        latest: fresh,
      })
    }
  })
}

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const step of signInScenarios) await step.run(desktop.page, stack)
  await scenario(desktop.page, stack)
  const over = report()

  if (over.length > 0) throw new Error(`Over budget: ${over.join(', ')}`)
  console.log('PASS chat switch timings')
} catch (error) {
  failed = true
  console.error(error)
  console.error(`FAIL: logs and the last screenshot are in ${artifacts}`)
} finally {
  await desktop?.close()
  await stopAll()
}
process.exit(failed ? 1 : 0)
