// #4022: a Task's question for the member's own Gmail is its Connect card, never "Reply…".
import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { rowOf } from './leave-helpers.ts'
import { inDatabase } from './personal-credential-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Listed = {
  conversations: { inputRequests?: { id: string; question: string; status?: string }[] }[]
}

const TASK = 'Read the support mail'
const QUESTION = 'Connect your gmail so the fixture can read support@ mail'
const LOGIN = 'e2e-gmail@example.com'

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

/** The question's card where it is shown now: the Task's, or the Inbox's. */
const card = (page: Page) => page.locator(`[data-decision-question="${QUESTION}"]:visible`).last()

async function shoot(page: Page, name: string) {
  await light(page)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${artifacts}/${name}-light.png` })
}

async function openInInbox(page: Page) {
  await page.getByRole('tab', { name: 'Inbox' }).click()
  await page.locator('[data-inbox-question]').filter({ hasText: QUESTION }).first().click()
  await card(page).waitFor()
}

export const personalConnectScenarios: Scenario[] = [
  {
    name: "a Task's question for your own Gmail is its Connect card; Use in task answers it and the Task continues",
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
      const userId = me.user?.id ?? me.id ?? ''
      const open = async () =>
        (
          (await owner('GET', `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`))
            .body as Listed
        ).conversations
          .flatMap((row) => row.inputRequests ?? [])
          .find((request) => request.question === QUESTION && (request.status ?? 'open') === 'open')

      try {
        await newTask(page)
        await send(page, `${TASK} E2E_ASK_PERSONAL:gmail E2E_DELIVERY:personal-gmail`)
        await page.getByText('ACK E2E_DELIVERY:personal-gmail').waitFor()
        const asked = agentLog(stack).find((entry) => entry.event === 'asked-personal')

        must(asked?.isError === false, `request_user_decision to take the Gmail question`)
        const requestId = (await open())?.id ?? ''

        must(Boolean(requestId), 'the Gmail question to be open')
        // Gmail is not connected yet: the card says so, and offers no words to reply with.
        await card(page).getByText('Not connected', { exact: true }).waitFor()
        must((await card(page).getByRole('button', { name: 'Other…' }).count()) === 0, 'no Other…')
        await shoot(page, 'personal-gmail-task-not-connected')
        await openInInbox(page)
        await card(page).getByText('Not connected', { exact: true }).waitFor()
        must((await page.getByRole('button', { name: 'Reply…' }).count()) === 0, 'no Reply…')
        await shoot(page, 'personal-gmail-inbox-not-connected')

        // The Google consent can't run here, so the grant it stores is written directly.
        inDatabase(
          stack,
          `await db.collection('personal_credentials').insertOne({
            userId: process.argv[2], provider: 'gmail', providerUserId: 'e2e-gmail',
            login: process.argv[4], teamId: process.argv[3], encryptedRefreshToken: null,
            accessTokenExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
          })`,
          userId,
          stack.teamId,
          LOGIN,
        )
        // Options already loaded predate the grant.
        await page.reload()
        await openInInbox(page)
        const use = card(page).getByRole('button', { name: 'Use in task', exact: true })

        await use.waitFor()
        await shoot(page, 'personal-gmail-inbox-use')
        await use.click()
        await until('the question to be answered by the selection', async () => !(await open()))
        // Nuphos starts the turn that tells the Task, naming what was selected and which question.
        const told = () =>
          agentLog(stack).find(
            (entry) =>
              entry.event === 'credentials-selected' &&
              entry.detail === `personal gmail ${requestId}`,
          )

        await until('the Task to be told Gmail is selected', async () => Boolean(told()))
        const woken = told()!
        const finished = () =>
          agentLog(stack).find(
            (entry) =>
              entry.event === 'finish' &&
              entry.sessionId === woken.sessionId &&
              entry.marker !== 'E2E_DELIVERY:personal-gmail',
          )

        await until('the woken turn to end', async () => Boolean(finished()))
        await page.getByRole('tab', { name: 'Tasks' }).click()
        await rowOf(page, TASK).click()
        await card(page).getByText('Connected', { exact: true }).waitFor()
        await page.getByText(`ACK ${finished()!.marker}`).filter({ visible: true }).last().waitFor()
        await shoot(page, 'personal-gmail-task-answered')
      } finally {
        inDatabase(
          stack,
          `await db.collection('personal_credentials').deleteMany({ login: process.argv[2] })`,
          LOGIN,
        )
      }
    },
  },
]
