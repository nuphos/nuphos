// `bun run e2e:chat-switch`: what a click on a chat's sidebar row shows, asserted without timing
// anything (real latency is the app's `chat_switch` event). Writes chat-switch.json and .md.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { backendLog } from './backend-log.ts'
import { kept, leave, notKept } from './chat-keep.ts'
import { LONG_POSTS, loadEarlier } from './chat-switch-earlier.ts'
import { watchSwitch } from './chat-switch-timing.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { recordScreencast } from './screencast.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'
import { newTask, send } from './ui.ts'

import type { SwitchWatch } from './chat-switch-timing.ts'
import type { Desktop } from './desktop.ts'
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

const BASELINE = join(import.meta.dirname, 'chat-switch-baseline.json')
// A post said in a Bot chat while away shows this soon after it opens.
const AWAY_MS = 300
const POSTS = 40
// A replay reaches the window in a few batches, so its end can come a frame or two after its
// start; a typewriter takes hundreds of frames.
const MAX_TYPED_FRAMES = 3
const ACK_A = 'ACK E2E_DELIVERY:switch-a'

type Chat = { tab: 'Tasks' | 'Bots'; title: string; sessionId: string }
type Case = {
  name: string
  watch: SwitchWatch
  /** Reads of this chat the backend got between the click and the chat's first frame. */
  requests: number
}

const cases: Case[] = []

async function api(stack: Stack, path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${stack.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify({ teamId: stack.teamId, ...body }) }),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as Record<string, unknown>
}

/** A group chat with history: the same view as a Bot's chat. */
async function chat(stack: Stack, title: string, posts = POSTS): Promise<Chat> {
  const made = (await api(stack, '/agent/channels', { title, group: true })) as {
    sessionId: string
  }

  for (let n = 1; n <= posts; n++)
    await api(stack, `/agent/conversations/${made.sessionId}/channel-messages`, {
      text: `${title} post ${String(n)}`,
    })

  return { tab: 'Bots', title, sessionId: made.sessionId }
}

const named = new Set<string>()

/** A Task whose first turn showed `shows`, named `title` so its row can be found. */
async function task(page: Page, stack: Stack, title: string, prompt: string, shows: string) {
  type Row = { sessionId: string; kind?: string; firstMessage?: string; title?: string }
  await newTask(page)
  await send(page, prompt)
  await page.getByText(shows).filter({ visible: true }).first().waitFor({ timeout: 60_000 })
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

  return { tab: 'Tasks', title, sessionId: row.sessionId } satisfies Chat
}

// Reads a chat's first frame can wait on, started in [from, to] (epoch ms): its conversation,
// and a Bot chat's agents. Its other requests race the frame either way.
function readsFor(sessionId: string, from: number, to: number) {
  const read = new RegExp(`^/agent/conversations/${sessionId}(/agents)?$`)

  return backendLog().filter((line) => {
    if (!line.includes('"http.request"') || !line.includes(sessionId)) return false
    const entry = JSON.parse(line) as {
      ts: string
      duration_ms: number
      method: string
      path: string
    }
    const started = Date.parse(entry.ts) - entry.duration_ms

    return entry.method === 'GET' && read.test(entry.path) && started >= from && started <= to
  }).length
}

async function open(
  page: Page,
  name: string,
  chat: Chat,
  texts: Parameters<typeof watchSwitch>[2],
  // `tab`: the sidebar's Tasks or Bots tab is the click, back to the chat it showed last.
  by: 'row' | 'tab' = 'row',
) {
  const tab = page.getByRole('tab', { name: chat.tab })

  if (by === 'row') await tab.click()
  const row = page
    .getByRole('tabpanel', { name: chat.tab })
    .locator('[data-sidebar-row]')
    .filter({ hasText: chat.title })
    .first()
  const watch = await watchSwitch(page, by === 'tab' ? tab : row, texts)
  const requests = readsFor(chat.sessionId, watch.clickedAt, watch.shownAt ?? Date.now())

  cases.push({ name, watch, requests })
  console.log(`${name}: ${JSON.stringify({ ...watch, requests })}`)
}

/** Back to a fresh renderer, as after starting the app: nothing opened, nothing cached. */
async function restart(page: Page) {
  // On a new Task, so the reloaded window restores no chat.
  await newTask(page)
  await page.reload()
  await page.getByRole('tab', { name: 'Tasks' }).waitFor()
}

const lastPost = (chat: Chat, posts = POSTS) => ({ history: `${chat.title} post ${String(posts)}` })

async function scenario(page: Page, stack: Stack) {
  const chatA = await chat(stack, 'Switch chat A')
  const chatB = await chat(stack, 'Switch chat B')
  const longChat = await chat(stack, 'Switch chat long', LONG_POSTS)
  const taskA = await task(page, stack, 'Switch task A', 'First E2E_DELIVERY:switch-a', ACK_A)
  const taskB = await task(
    page,
    stack,
    'Switch task B',
    'Second E2E_DELIVERY:switch-b',
    'ACK E2E_DELIVERY:switch-b',
  )
  // Its reply stays in progress for the rest of the run.
  const long = await task(
    page,
    stack,
    'Switch task long',
    'Long E2E_LONG E2E_HOLD E2E_DELIVERY:switch-long',
    // Started is enough: the whole reply is on the server at once, however long it takes to show.
    'LONG_START',
  )

  await restart(page)
  await open(page, 'task, first open', taskA, { history: ACK_A })
  await leave(page, taskA.title, ACK_A)
  await open(page, 'task, first open, reply in progress', long, {
    history: 'Long E2E_LONG',
    newest: 'LONG_END',
    typedFrom: 'LONG_START',
    typedTo: 'LONG_END',
  })
  await open(page, 'bot chat, first open', chatA, lastPost(chatA))
  await leave(page, chatA.title, lastPost(chatA).history)
  await open(page, 'task, first open, another', taskB, { history: 'ACK E2E_DELIVERY:switch-b' })
  await open(page, 'task, opened before', taskA, { history: ACK_A })
  await kept(page, 'task, opened before', taskA.title, ACK_A)
  await open(page, 'bot chat, first open, another', chatB, lastPost(chatB))
  await open(page, 'bot chat, opened before', chatA, lastPost(chatA))
  await kept(page, 'bot chat, opened before', chatA.title, lastPost(chatA).history)
  // Said in chat B while chat A is on screen.
  await api(stack, `/agent/conversations/${chatB.sessionId}/channel-messages`, {
    text: 'Said while away',
  })
  await open(page, 'bot chat, new post while away', chatB, {
    ...lastPost(chatB),
    newest: 'Said while away',
  })
  // From a Bot chat back to Tasks, where a reply in progress was open: its streamed words
  // were hidden meanwhile, and must not fade in again.
  await open(page, 'task, opened before, reply in progress', long, { history: 'LONG_END' })
  await open(page, 'bot chat, opened before, again', chatA, lastPost(chatA))
  await open(page, 'tasks tab, back to a reply in progress', long, { history: 'LONG_END' }, 'tab')
  await open(page, 'bot chat, first open, 200 posts', longChat, lastPost(longChat, LONG_POSTS))
  await loadEarlier(page, longChat.title)
}

/** What fails the run. */
function check(baseline: Record<string, number> | null) {
  const failed: string[] = []
  const lines = [
    '| Switch | Frames to content | ms to content | Reads before content | Fade frames | Wash frames | Typed frames | Newest after |',
    '| --- | --: | --: | --: | --: | --: | --: | --: |',
  ]

  for (const { name, watch, requests } of cases) {
    const fail = (why: string) => failed.push(`${name}: ${why}`)
    const allowed = baseline?.[name]
    const newest = watch.newestAfterMs === null ? 'never' : `${String(watch.newestAfterMs)} ms`

    if (watch.framesToContent === null) fail('its history never showed')
    if (watch.fadeFrames > 0) fail(`${String(watch.fadeFrames)} frames faded it in`)
    if (watch.washFrames > 0)
      fail(
        `${String(watch.washFrames)} frames had faded text in the pane, faintest ${String(watch.washedText)}`,
      )
    if (watch.chipFrames > 0)
      fail(
        `${String(watch.chipFrames)} frames showed a composer chip before its value: ${String(watch.chipText)}`,
      )
    if (watch.typedFrames > MAX_TYPED_FRAMES)
      fail(`a reply in progress was typed out over ${String(watch.typedFrames)} frames`)
    if (allowed !== undefined && requests > allowed)
      fail(`${String(requests)} reads before its first frame, baseline ${String(allowed)}`)
    lines.push(
      `| ${name} | ${String(watch.framesToContent ?? 'never')} | ${watch.shownAt === null ? 'never' : String(Math.round(watch.shownAt - watch.clickedAt))} | ${String(requests)} | ${String(watch.fadeFrames)} | ${String(watch.washFrames)} | ${String(watch.typedFrames)} | ${newest} |`,
    )
  }
  // A chat opened before shows on the first frame, with no request first: a Task, and a Bot
  // chat kept mounted (#3523).

  for (const { name, watch, requests } of cases.filter((c) => c.name.endsWith('opened before'))) {
    if (watch.framesToContent === 1 && requests === 0) continue
    failed.push(`${name}: not on the first frame without a read`)
  }
  // The same view as it was left, not one rebuilt on the way back.
  for (const line of notKept) failed.push(`${line} (not kept as left)`)
  const away = cases.find(({ name }) => name === 'bot chat, new post while away')

  // Heard of at once from the backend's push, not on a poll (#3523).
  if (away && (away.watch.newestAfterMs ?? Infinity) >= AWAY_MS)
    failed.push(
      `${away.name}: the newest post took ${String(away.watch.newestAfterMs)} ms, budget ${String(AWAY_MS)} ms`,
    )

  return { failed, table: lines.join('\n') }
}

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  // OpenAB relays a reply's text as it comes, as the runtime image and Desktop's own runtime do,
  // so a reply in progress is on screen before its turn ends.
  process.env.OPENAB_ACP_STREAMING = 'true'
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  const { page } = desktop

  for (const step of signInScenarios) await step.run(page, stack)
  // The recording is the pull request's evidence of what a switch looks like.
  await recordScreencast(page, 'chat-switch-frames', () => scenario(page, stack))
  const baseline = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>)
    : null
  const result = check(baseline)
  const report = [result.table, '', ...result.failed.map((line) => `- **Failed**: ${line}`)].join(
    '\n',
  )

  writeFileSync(
    `${artifacts}/chat-switch.json`,
    JSON.stringify(
      Object.fromEntries(cases.map(({ name, requests }) => [name, requests])),
      null,
      2,
    ),
  )
  writeFileSync(`${artifacts}/chat-switch.md`, `${report}\n`)
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Chat switch\n\n${report}\n`)
  if (result.failed.length > 0) throw new Error(result.failed.join('\n'))
  console.log('PASS chat switch')
} catch (error) {
  failed = true
  console.error(error)
  console.error(`FAIL: logs and the last screenshot are in ${artifacts}`)
} finally {
  await desktop?.close()
  await stopAll()
}
process.exit(failed ? 1 : 0)
