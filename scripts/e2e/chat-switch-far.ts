// The chat switch with the backend far away (#3523): every request, answer and socket frame of
// the app's held 150-300 ms a round trip, where a read queued behind another shows as blank.
import { send } from './ui.ts'

import type { SwitchWatch } from './chat-switch-timing.ts'
import type { startLatencyProxy } from './latency-proxy.ts'
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

type Chat = { tab: 'Tasks' | 'Bots'; title: string; sessionId: string }
type Texts = { history: string; newest?: string }

/** The run's own helpers and chats, passed in so this file does not import the run. */
export type Far = {
  task: (page: Page, stack: Stack, title: string, prompt: string, shows: string) => Promise<Chat>
  open: (page: Page, name: string, chat: Chat, texts: Texts) => Promise<void>
  restart: (page: Page) => Promise<void>
  api: (stack: Stack, path: string, body: unknown) => Promise<unknown>
  lastPost: (chat: Chat) => Texts
  taskA: Chat
  chatA: Chat
  chatB: Chat
}
export type Proxy = Awaited<ReturnType<typeof startLatencyProxy>>

// A finished Task with many turns of tool cards, as a Bot's long run.
const TURNS = 8
const turn = (n: number) => `E2E_DELIVERY:switch-done-${String(n).padStart(2, '0')}`
// A post said in a Bot chat while away is heard of from the backend's push, not on a poll,
// and shows this soon after it opens: far away, the push's hop and one read, not two.
const AWAY_MS: Record<string, number> = {
  'bot chat, new post while away': 300,
  'far: bot chat, new post while away': 500,
}
const AWAY = 'far: bot chat, new post while away'

export async function farScenario(page: Page, stack: Stack, proxy: Proxy, far: Far) {
  const { taskA, chatA, chatB, lastPost } = far
  const open = (name: string, chat: Chat, texts: Texts) => far.open(page, name, chat, texts)
  const first = `Done E2E_TOOLS ${turn(1)}`
  const done = await far.task(page, stack, 'Switch task done', first, `ACK ${turn(1)}`)

  for (let n = 2; n <= TURNS; n++) {
    await send(page, `Done E2E_TOOLS ${turn(n)}`)
    await page
      .getByText(`ACK ${turn(n)}`)
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 60_000 })
  }
  proxy.latency(150, 300)
  await probe(stack, proxy.url)
  await far.restart(page)
  await open('far: long finished task, first open', done, { history: `ACK ${turn(TURNS)}` })
  await open('far: task, first open', taskA, { history: 'ACK E2E_DELIVERY:switch-a' })
  await open('far: bot chat, first open', chatB, lastPost(chatB))
  await open('far: bot chat, first open, another', chatA, lastPost(chatA))
  await far.api(stack, `/agent/conversations/${chatB.sessionId}/channel-messages`, {
    text: 'Said while far away',
  })
  await open(AWAY, chatB, { ...lastPost(chatB), newest: 'Said while far away' })
  proxy.latency(0)
}

/** That the latency applies: three reads straight to the backend, and three through the proxy. */
async function probe(stack: Stack, proxied: string) {
  const path = `/agent/conversations?teamId=${stack.teamId}&limit=1`
  const time = async (base: string) => {
    const started = performance.now()

    await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${stack.token}` } })

    return Math.round(performance.now() - started)
  }
  const times = async (base: string) => [await time(base), await time(base), await time(base)]

  console.log(
    `latency: direct ${(await times(stack.apiUrl)).join('/')} ms, far ${(await times(proxied)).join('/')} ms`,
  )
}

/** What fails the run here beyond the shared checks; the reads are budgeted in the baseline. */
export function farFailed(cases: { name: string; watch: SwitchWatch }[]) {
  return cases.flatMap(({ name, watch }) => {
    const budget = AWAY_MS[name]
    const after = watch.newestAfterMs ?? Infinity

    return budget !== undefined && after >= budget
      ? [`${name}: the newest post took ${String(after)} ms, budget ${String(budget)} ms`]
      : []
  })
}
