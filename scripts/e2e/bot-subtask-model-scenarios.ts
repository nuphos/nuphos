// The model a Bot's sub-Task names in its chip, in the chat of the Bot an earlier scenario created.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentEvents, agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { send, transcriptPost } from './ui.ts'

import type { Scenario } from './ui.ts'

export const botSubtaskModelScenarios: Scenario[] = [
  {
    // #3409: a sub-Task on a model its computer's list lacked named no model in its chip.
    name: "a Bot's sub-Task names its model when its computer's list lacks it",
    run: async (page, stack) => {
      const bots = page.getByRole('tabpanel', { name: 'Bots' })
      const bot = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      const kid = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E unlisted kid' }).first()
      const behind = join(artifacts, 'behind')
      // The sub-Task answers only once this exists: the sidebar lists a sub-Task while it runs,
      // and a fixture turn is shorter than the session list's 4 s poll.
      const release = join(artifacts, 'release')
      const light = () =>
        page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })

      await page.getByRole('tab', { name: 'Bots' }).click()
      await bot.click()
      // The sub-Task's session runs a model the agent's own list never offers.
      writeFileSync(behind, 'fixture-unlisted')
      rmSync(release, { force: true })
      try {
        await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:unlisted-handoff')
        // A running sub-Task is listed under the Bot once its tree is open. Opened from there,
        // it stays listed when it finishes, since it is the open chat.
        const tree = bots.locator('[aria-label="Show sub-tasks"], [aria-label="Hide sub-tasks"]')

        await tree.first().waitFor()
        if ((await tree.first().getAttribute('aria-label')) === 'Show sub-tasks')
          await tree.first().dispatchEvent('click')
        await kid.click()
        const chip = page.getByRole('button', { name: /^Model settings/ }).last()

        // #3789: while it still runs, its chip names the model its session reports, not the
        // agent's listed default. The reply is held until the release file exists.
        await until("the running sub-Task's chip to name its model", async () =>
          (await chip.getAttribute('aria-label'))?.startsWith('Model settings: fixture-unlisted'),
        )
        await light()
        await page.screenshot({ path: `${artifacts}/bot-subtask-model-running-light.png` })
        writeFileSync(release, '')
        await until('the sub-Task to reply', async () =>
          agentEvents(stack).includes('finish E2E_DELIVERY:unlisted-kid'),
        )
        await page.getByText('ACK E2E_DELIVERY:unlisted-kid').waitFor()
        // Still after the turn.
        if (
          !(await chip.getAttribute('aria-label'))?.startsWith('Model settings: fixture-unlisted')
        )
          throw new Error("The finished sub-Task's chip no longer names its model")
        await light()
        await page.screenshot({ path: `${artifacts}/bot-subtask-model-light.png` })
        // #4131: a short Task title sits as close to "(a Task)" as the line's other parts.
        // Measured from the title's own text, since a padded part around it is the bug.
        const gap = await page
          .getByText('(a Task)', { exact: true })
          .first()
          .evaluate((el) => {
            const title = [...el.parentElement!.querySelectorAll('span.truncate')].find(
              (span) => span.textContent === 'E2E Bot',
            )!

            return el.getBoundingClientRect().left - title.getBoundingClientRect().right
          })

        if (gap > 5) throw new Error(`"(a Task)" stands ${String(gap)}px from the Task's title`)
      } finally {
        // Kept until the chip names the model: the app reads it again once the sub-Task ends.
        rmSync(behind, { force: true })
        rmSync(release, { force: true })
      }
      // Back in the Bot's chat, where the channel scenarios carry on. #4602: the sub-Task is
      // finished, read and no longer open, and still stays under its Bot, past the session
      // list's 4 s poll. The Bot's row shows no count beside it.
      await bot.click()
      await page.mouse.move(600, 400)
      await page.waitForTimeout(5_000)
      if (!(await kid.isVisible())) throw new Error('The finished sub-Task left the Bot tree')
      await light()
      await bots.screenshot({ path: `${artifacts}/bot-row-light.png` })
      // The tree's fold hides the finished sub-Task and brings it back.
      await bot.locator('[aria-label="Hide sub-tasks"]').dispatchEvent('click')
      await kid.waitFor({ state: 'detached' })
      await light()
      await bots.screenshot({ path: `${artifacts}/bot-row-folded-light.png` })
      await bot.locator('[aria-label="Show sub-tasks"]').dispatchEvent('click')
      await kid.waitFor()
      if (await bots.locator('[title$=" done"]').count())
        throw new Error("The Bot's row still shows a done count")
    },
  },
  {
    // #4156: a Bot hands two requests to two sub-Tasks and still answers a third message while
    // both run. The fixture delegates by marker; the Bot's own session must carry the rule.
    name: 'a Bot answers while two sub-Tasks it started still run',
    run: async (page, stack) => {
      const release = join(artifacts, 'release')
      const did = (event: string, kid: string) =>
        agentEvents(stack).includes(`${event} E2E_DELIVERY:${kid}`)

      rmSync(release, { force: true })
      try {
        await send(page, 'Look into the first thing E2E_SUBTASK E2E_DELIVERY:par-a')
        await until('the first sub-Task to start', async () => did('start', 'par-a-kid'))
        await send(page, 'Look into the second thing E2E_SUBTASK E2E_DELIVERY:par-b')
        await until('the second sub-Task to start', async () => did('start', 'par-b-kid'))
        await send(page, 'Quick question E2E_DELIVERY:par-quick')
        await transcriptPost(page, 'POSTED E2E_DELIVERY:par-quick').waitFor()
        if (did('finish', 'par-a-kid') || did('finish', 'par-b-kid'))
          throw new Error('A sub-Task finished before the Bot answered')
        await page.screenshot({ path: `${artifacts}/bot-parallel-subtasks-light.png` })
      } finally {
        writeFileSync(release, '')
      }
      await until('both sub-Tasks to finish', async () =>
        ['par-a-kid', 'par-b-kid'].every((kid) => did('finish', kid)),
      )
      rmSync(release, { force: true })
      const log = agentLog(stack)
      const sessionOf = (event: string, marker: string) =>
        log.find((entry) => entry.event === event && entry.marker === `E2E_DELIVERY:${marker}`)
          ?.sessionId
      const told = (sessionId?: string) =>
        log.some((entry) => entry.sessionId === sessionId && entry.delegates)

      if (!told(sessionOf('subtask', 'par-a')))
        throw new Error("The Bot's session was not told to delegate work")
      if (told(sessionOf('start', 'par-a-kid')))
        throw new Error('A sub-Task was told to delegate work, which only a Bot is')
    },
  },
]
