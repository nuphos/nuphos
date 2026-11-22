// A Task's turn: Stop while it runs or starts, and the questions its agent asks.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentEvents, agentLog } from './agent-log.ts'
import { client } from './binding-access-scenarios.ts'
import { checkDecisionOutline } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { createWebhook, deliver } from './trigger-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const turnScenarios: Scenario[] = [
  {
    // The flow #2812 was reported in. Its race (a Stop during the queued turn's startup) is not reproduced.
    name: 'queue a message during a turn, press Stop, and the queued message still runs',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Work until stopped E2E_HOLD E2E_DELIVERY:held')
      await until('the agent to start the held turn', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:held'),
      )
      await send(page, 'Then this E2E_DELIVERY:queued')
      await page.getByText('Queued messages').waitFor()
      await page.locator('button[title="Stop"]:visible').click()
      await page.getByText('Turn stopped').filter({ visible: true }).waitFor()
      await page.getByText('ACK E2E_DELIVERY:queued').waitFor()
      const events = agentEvents(stack)

      if (
        events.indexOf('cancelled E2E_DELIVERY:held') > events.indexOf('start E2E_DELIVERY:queued')
      ) {
        throw new Error(`The queued message ran before the turn was stopped: ${events.join(', ')}`)
      }
    },
  },
  {
    // #4371: a parent ran one turn per Task that reported while it worked, so Stop kept waking it.
    // Tasks report here with send_message_to_thread: report_task needs Redis, which this stack has
    // not, and its delivery queues the same agent.thread message on the parent.
    name: 'Tasks and a webhook alert that arrive while their parent works are answered in one turn',
    run: async (page, stack) => {
      const names = ['a', 'b', 'c']
      const log = () => agentLog(stack)
      const release = join(artifacts, 'release')

      await newTask(page)
      // The first message names the Task, and a Task's prompt carries its parent's name.
      await send(page, 'Collect reports E2E_DELIVERY:collect')
      await page.getByText('ACK E2E_DELIVERY:collect').waitFor()
      const api = client(stack.apiUrl, stack.token)
      const found = await api(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&search=${encodeURIComponent('Collect reports')}`,
      )
      // The Nuphos session, which send_message_to_thread names; the agent's own differs.
      const parent = (found.body as { conversations: { sessionId: string }[] }).conversations[0]!
        .sessionId
      const acpParent = log().find((entry) => entry.marker === 'E2E_DELIVERY:collect')!.sessionId
      const report = (name: string) =>
        JSON.stringify({
          label: 'Report',
          threadId: parent,
          prompt: `Done E2E_DELIVERY:report-${name}`,
        })
      const delegate = (name: string) =>
        `E2E_CALL create_thread ${JSON.stringify({
          label: 'Delegate',
          title: `E2E reporter ${name}`,
          prompt: `Report E2E_CALL send_message_to_thread ${report(name)} E2E_DELIVERY:reporter-${name}`,
        })}`
      const reported = () =>
        log().filter((entry) => entry.event === 'called' && entry.name === 'send_message_to_thread')

      rmSync(release, { force: true })
      // One E2E_CALL per line, in one message.
      await page
        .getByRole('textbox', { name: 'Message' })
        .fill(
          [...names.map(delegate), 'Wait for them E2E_WAIT_RELEASE E2E_DELIVERY:collecting'].join(
            '\n',
          ),
        )
      await page.keyboard.press('Enter')
      await until('every Task to report while its parent works', async () =>
        reported().length >= names.length ? true : undefined,
      )
      const refused = reported().filter((entry) =>
        JSON.stringify(entry.result).includes('"isError":true'),
      )

      if (refused.length > 0) throw new Error(`A report was refused: ${JSON.stringify(refused)}`)
      // A resource event waiting behind the reports joins the same turn.
      const hook = await createWebhook(stack, parent, 'Alerts for the parent')
      const alert = await deliver(stack, hook, { state: 'firing', id: 'report-alert' })

      if (alert.status !== 200 || !alert.body.ok)
        throw new Error(`The alert was not accepted: ${JSON.stringify(alert)}`)
      const turns = () =>
        log().filter(
          (entry) =>
            entry.sessionId === acpParent &&
            entry.event === 'start' &&
            entry.marker !== 'E2E_DELIVERY:collecting' &&
            [...names, 'alert'].some((name) =>
              entry.markers?.includes(`E2E_DELIVERY:report-${name}`),
            ),
        )

      writeFileSync(release, '')
      await until('the parent to answer the reports', async () =>
        turns().length > 0 ? true : undefined,
      )
      // Long enough for a second turn to start, were the reports still run one at a time.
      await page.waitForTimeout(5_000)
      const started = turns()

      rmSync(release, { force: true })

      if (
        started.length !== 1 ||
        ![...names, 'alert'].every((name) =>
          started[0]!.markers?.includes(`E2E_DELIVERY:report-${name}`),
        )
      ) {
        throw new Error(
          `The reports and the alert did not run in one turn: ${JSON.stringify(started)}`,
        )
      }
      // Each report keeps its own Task as its sender.
      const tasks = log()
        .filter((entry) => entry.event === 'called' && entry.name === 'create_thread')
        .map((entry) => /threadId[\\": ]*([0-9a-f-]{36})/.exec(JSON.stringify(entry.result))?.[1])
      const read = await api('GET', `/agent/conversations/${parent}?teamId=${stack.teamId}`)
      const messages = (read.body as { messages: unknown[] }).messages.map((entry) =>
        JSON.stringify(entry),
      )
      const senders = names.map((name) =>
        tasks.find((task) =>
          messages.some(
            (entry) =>
              entry.includes(`Done E2E_DELIVERY:report-${name}`) &&
              new RegExp(`"sender":\\{[^}]*"id":"${task}"`).test(entry),
          ),
        ),
      )

      if (senders.some((sender) => !sender) || new Set(senders).size !== names.length) {
        throw new Error(`A report lost its own sender: ${JSON.stringify(senders)}`)
      }
    },
  },
  {
    // #2872: the agent read the message once its session opened, seconds after the Stop.
    name: 'Stop while the agent is still starting, and the agent never reads the message',
    run: async (page, stack) => {
      const openings = () => agentEvents(stack).filter((event) => event === 'opening').length
      const before = openings()
      const open = stack.holdSessionOpening()

      try {
        await newTask(page)
        await send(page, 'Stopped before it starts E2E_DELIVERY:stopped')
        await until('the agent to be asked for a session', async () => openings() > before)
        await page.locator('button[title="Stop"]:visible').click()
        // The Stop has to reach the agent host while the session is still opening.
        await page.waitForTimeout(2_000)
      } finally {
        open()
      }
      await page.getByText('Turn stopped').filter({ visible: true }).waitFor()
      await send(page, 'Sent after the stop E2E_DELIVERY:after-stop')
      await page.getByText('ACK E2E_DELIVERY:after-stop').waitFor()
      const events = agentEvents(stack)

      if (events.includes('start E2E_DELIVERY:stopped')) {
        throw new Error(`The agent read a message stopped before it started: ${events.join(', ')}`)
      }
    },
  },
  {
    // An ordinary question. #2412 was a credential-category card in a Bot chat, which this does not cover.
    name: 'the agent asks a question and the answer on its card reaches the agent',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:asking')
      await page
        .getByRole('heading', { name: 'Which marker should the fixture use?' })
        .last()
        .waitFor()
      await checkDecisionOutline(page)
      await page.screenshot({ path: `${artifacts}/question-pending.png` })
      // #2972: a question is answered on its card; nothing above the composer answers it.
      if (await page.getByRole('group', { name: 'Reply target' }).count()) {
        throw new Error('A "Replying to" chip is above the composer')
      }
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await page.getByText('ACK E2E_DELIVERY:answered').filter({ visible: true }).waitFor()
    },
  },
  {
    // The flow #2844 was reported in. Reverting its fix does not fail this, so its trigger is not covered.
    name: 'a link in an Inbox question keeps the question, which is then answered from the Inbox',
    run: async (page, stack) => {
      await send(page, 'Ask again E2E_ASK E2E_DELIVERY:again')
      await page.getByText('ACK E2E_DELIVERY:again').waitFor()
      // #2972: what the composer sends meanwhile is an ordinary message; the question stays open.
      await send(page, 'A note while it waits E2E_DELIVERY:note')
      await page.getByText('ACK E2E_DELIVERY:note').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('link', { name: /\/health\/ready$/ }).click()
      // The link opens in the dock; give a wrong navigation the time to happen.
      await page.waitForTimeout(2_000)
      await page.getByRole('button', { name: 'E2E_DELIVERY:other' }).click()
      await until('the Inbox answer to reach the agent', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:other'),
      )
    },
  },
  {
    // #2870: a credential question with choices and no secret to save is an ordinary choice card.
    name: 'the agent asks a credential question with choices and its card and the Inbox answer it',
    run: async (page, stack) => {
      const finished = () =>
        agentEvents(stack).filter((event) => event === 'finish E2E_DELIVERY:other').length
      const before = finished()

      await newTask(page)
      await send(page, 'Ask me E2E_ASK_CREDENTIAL E2E_DELIVERY:credential')
      // A credential question with choices is an ordinary question card, with no category label.
      await page
        .getByRole('heading', { name: 'Which marker should the fixture use?' })
        .last()
        .waitFor()
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await page.getByText('ACK E2E_DELIVERY:answered').filter({ visible: true }).waitFor()
      await send(page, 'Ask again E2E_ASK_CREDENTIAL E2E_DELIVERY:credential-again')
      await page.getByText('ACK E2E_DELIVERY:credential-again').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('button', { name: 'E2E_DELIVERY:other' }).click()
      await until('the Inbox answer to reach the agent', async () => finished() === before + 1)
    },
  },
  {
    // #2998: Skip withdrew the question silently; the agent that asked was never told.
    // #3231: Skip is Dismiss now.
    name: 'dismissing a question on its card tells the agent that asked',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:dismiss')
      await page.getByText('ACK E2E_DELIVERY:dismiss').waitFor()
      await page.getByRole('button', { name: 'Dismiss', exact: true }).last().click()
      // The card leaves with its question; the agent's wake notice stays in the chat.
      await page.getByText(/was dismissed by .*: no answer is coming/).waitFor()
      await until('the agent to be told its question was dismissed', async () =>
        agentEvents(stack).includes('dismissed E2E_DELIVERY:missing'),
      )
      await page.getByText('ACK E2E_DELIVERY:missing').waitFor()
      await page.screenshot({ path: `${artifacts}/question-dismissed.png` })
    },
  },
]
