// Scenarios about what becomes of an agent's question, through the real routes.
import { mkdirSync, writeFileSync } from 'node:fs'

import { agentEvents, agentLog } from './agent-log.ts'
import { backendLines, backendLog } from './backend-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { choiceModeScenarios } from './choice-mode-scenarios.ts'
import { decisionTitleScenarios } from './decision-title-scenarios.ts'
import { inboxScenarios } from './inbox-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { staleQuestionScenarios } from './stale-question-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Listed = {
  conversations: { sessionId: string; firstMessage?: string; inputRequests?: Asked[] }[]
}
type Asked = { id: string; snoozedUntil?: string }

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

const openInInbox = (page: Page) =>
  page.locator('[data-inbox-question][aria-current="true"]').getAttribute('data-inbox-question')
const listedInInbox = (page: Page) =>
  page
    .locator('[data-inbox-question]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-inbox-question') ?? ''))

/** Records, for each Inbox row added from now on, how many animations it starts with. */
const watchInboxRows = (page: Page) =>
  page.evaluate(() => {
    const entered: Record<string, number> = {}

    Object.assign(window, { inboxEntered: entered })
    new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        if (!(node instanceof HTMLElement)) continue
        for (const row of node.querySelectorAll<HTMLElement>('[data-inbox-question]')) {
          const id = row.dataset.inboxQuestion ?? ''

          // The row's own wrapper, not its page's: a page switching in animates too.
          entered[id] = Math.max(entered[id] ?? 0, row.parentElement?.getAnimations().length ?? 0)
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })

/** Saves the window's frames to `<artifacts>/<name>/` until the returned stop is called. */
export async function screencast(page: Page, name: string) {
  const dir = `${artifacts}/${name}`
  const cdp = await page.context().newCDPSession(page)
  let frame = 0

  mkdirSync(dir, { recursive: true })
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    frame += 1
    writeFileSync(`${dir}/${String(frame).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'))
    void cdp.send('Page.screencastFrameAck', { sessionId })
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 })

  // A reload may have ended the screencast already.
  return () => cdp.send('Page.stopScreencast').catch(() => {})
}

export const questionScenarios: Scenario[] = [
  {
    // #3397: an answer being typed in a question's card stays when the asking turn ends.
    name: "an answer typed while the agent's turn runs is still there when the turn ends",
    run: async (page) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:typed')
      await page.getByRole('heading', { name: 'Which marker should the fixture use?' }).waitFor()
      await page.getByRole('button', { name: 'Other…' }).last().click()
      await page.getByLabel('Your answer').last().fill('E2E_DELIVERY:typed-answer')
      await page.getByText('ACK E2E_DELIVERY:typed').waitFor()
      // The app takes the stored transcript within a second of the turn's end.
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const kept = await page.getByLabel('Your answer').last().inputValue()

      if (kept !== 'E2E_DELIVERY:typed-answer')
        throw new Error(`The card lost the answer being typed when the turn ended: "${kept}"`)
      await page.keyboard.press('Enter')
      await page.getByText('ACK E2E_DELIVERY:typed-answer').waitFor()
    },
  },
  {
    // #3292: the question being read in the Inbox was replaced when a newer one was listed.
    name: 'a newer question slides into the Inbox list and the one being read stays open',
    run: async (page) => {
      const entered = () =>
        page.evaluate(
          () => (window as { inboxEntered?: Record<string, number> }).inboxEntered ?? {},
        )

      // The sidebar keeps the Inbox list mounted, so its rows are added as they are asked.
      await watchInboxRows(page)
      for (const marker of ['stay-a', 'stay-b', 'stay-c']) {
        await newTask(page)
        await send(page, `Ask me E2E_ASK E2E_DELIVERY:${marker}`)
        await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
      }
      await until('the three questions to be listed', async () => {
        const rows = Object.values(await entered())

        return rows.length >= 3 && rows.every((animations) => animations > 0)
      })
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await light(page)
      await page.locator('[data-inbox-question]').first().click()
      // Answered, the question leaves and the one that takes its place opens.
      await page.getByRole('button', { name: 'E2E_DELIVERY:other' }).click()
      await page.getByRole('heading', { name: /^Answered/ }).waitFor()
      const reading = await openInInbox(page)
      const before = await listedInInbox(page)

      must(Boolean(reading), 'a question to be open after answering one')
      await page.screenshot({ path: `${artifacts}/inbox-reading-light.png` })
      // A newer question is asked meanwhile; it is listed first.
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:stay-new')
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await light(page)
      const stop = await screencast(page, 'inbox-arrival')
      let added: string | undefined

      await until('the newer question to be listed', async () => {
        added = (await listedInInbox(page)).find((id) => !before.includes(id))

        return added
      })
      await page.waitForTimeout(1_000)
      await stop()
      await page.screenshot({ path: `${artifacts}/inbox-after-arrival-light.png` })
      const open = await openInInbox(page)
      const animations = (await entered())[added!] ?? 0

      must(open === reading, `the question being read to stay open, ${reading} became ${open}`)
      must(animations > 0, 'the newer question to enter its list with a transition')
      // The whole list entering at once, as it does when the app starts on the Inbox.
      await page.emulateMedia({ colorScheme: 'light' })
      const reload = await screencast(page, 'inbox-first-render')

      await page.reload()
      await light(page)
      const inbox = page.getByRole('tab', { name: 'Inbox' })

      if ((await inbox.getAttribute('aria-selected')) !== 'true') await inbox.click()
      await page.locator('[data-inbox-question]').first().waitFor()
      await page.waitForTimeout(1_500)
      await reload()
      await page.emulateMedia({ colorScheme: null })
    },
  },
  {
    // #3231: Snooze sets a question aside without telling the agent; Dismiss tells it why.
    name: 'a snoozed question stays open and the agent is not told; a dismissal tells it why',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const asked = async () => {
        const listed = await owner(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
        )
        const row = (listed.body as Listed).conversations.find((conversation) =>
          conversation.firstMessage?.includes('E2E_DELIVERY:snooze'),
        )

        return { sessionId: row?.sessionId ?? '', request: row?.inputRequests?.[0] }
      }
      const decide = (sessionId: string, id: string, path: string, body: unknown) =>
        owner(
          'POST',
          `/agent/conversations/${sessionId}/decisions/${id}/${path}?teamId=${stack.teamId}`,
          body,
        )

      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:snooze')
      await page.getByText('ACK E2E_DELIVERY:snooze').waitFor()
      // Counted once the asking turn is over, so only a wake could add to it.
      await until('the asking turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:snooze'),
      )
      const { sessionId, request } = await asked()

      must(Boolean(request), 'the question to be listed')
      const until1h = new Date(Date.now() + 3_600_000).toISOString()
      // A wake starts a turn. The question's own turn may still be logging its finish, and
      // other sessions open while runtimes are probed, so neither counts.
      const turns = () => agentEvents(stack).filter((event) => event.startsWith('start')).length
      const before = turns()
      const snoozed = await decide(sessionId, request!.id, 'snooze', { until: until1h })

      must(
        snoozed.status === 200,
        `snooze to succeed, got ${String(snoozed.status)} ${snoozed.text}`,
      )
      must((await asked()).request?.snoozedUntil === until1h, 'the listing to carry snoozedUntil')
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      must(turns() === before, 'a snooze to wake no agent')

      const dismissed = await decide(sessionId, request!.id, 'resolve', {
        resolution: 'dismissed',
        reason: 'E2E_DELIVERY:dismiss-reason',
      })

      must(dismissed.status === 200, `dismiss to succeed, got ${String(dismissed.status)}`)
      await until('the agent to be told its question was dismissed, and why', async () =>
        agentEvents(stack).includes('dismissed E2E_DELIVERY:dismiss-reason'),
      )
      await page.getByText(/was dismissed by .*: no answer is coming/).waitFor()
      must(!(await asked()).request, 'a dismissed question to leave the listing')
    },
  },
  {
    // #3265: an answer given while the agent host was away reopened its question as "did not
    // run", though the answer was kept in the conversation, so it was both delivered and open.
    name: 'an answer given while the agent host is away reaches it once back, and its question stays answered',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)

      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:away-ask')
      await page.getByText('ACK E2E_DELIVERY:away-ask').waitFor()
      const sessionId = agentLog(stack).find(
        (entry) => entry.marker === 'E2E_DELIVERY:away-ask',
      )?.sessionId
      const answered = () =>
        agentLog(stack).filter(
          (entry) =>
            entry.sessionId === sessionId &&
            entry.event === 'start' &&
            entry.marker === 'E2E_DELIVERY:answered',
        ).length

      await stack.restartAgentHost(async () => {
        const from = backendLines()

        await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).last().click()
        await until('the answer to be taken', async () =>
          backendLog(from).some(
            (line) => line.includes('/answer') && line.includes('"status":200'),
          ),
        )
        // The turn it wakes finds the host away well within this.
        await page.waitForTimeout(5_000)
      })
      const reached = await page
        .getByText('ACK E2E_DELIVERY:answered')
        .waitFor({ timeout: 90_000 })
        .then(
          () => true,
          () => false,
        )

      await page.reload()
      await light(page)
      await page.waitForTimeout(2_000)
      await page.screenshot({ path: `${artifacts}/question-answered-while-away-light.png` })
      must(reached, 'the answer to reach the agent once its host was back')
      must(
        (await page.getByText(/did not run/).count()) === 0,
        'no "did not run" question in the chat',
      )
      // The card stays in the transcript, as a real agent's does, but answered and without choices.
      must(
        (await page.getByText('Answered: E2E_DELIVERY:answered').count()) > 0 &&
          (await page.getByRole('button', { name: 'E2E_DELIVERY:other' }).count()) === 0,
        'the question card answered, not open again',
      )
      const listed = await owner(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
      )
      const open = (listed.body as Listed).conversations.find(
        (conversation) => conversation.sessionId === sessionId,
      )?.inputRequests

      must(!open?.length, `no open question in the Inbox, got ${JSON.stringify(open)}`)
      // Long enough for a second delivery to have started, had there been one.
      await page.waitForTimeout(3_000)
      must(answered() === 1, `the answer to reach the agent once, got ${String(answered())}`)
    },
  },
  ...decisionTitleScenarios,
  ...staleQuestionScenarios,
  ...inboxScenarios,
  ...choiceModeScenarios,
]
