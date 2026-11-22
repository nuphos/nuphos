// #3184: a turn its runtime cannot run leads to that runtime's team fallback.
import { agentLog } from './agent-log.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickInRow, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Locator, Page } from 'playwright-core'

const FIXTURE = 'E2E fixture agent'
const SECOND = 'E2E second agent'

async function choose(page: Page, trigger: Locator, label: string) {
  await trigger.click()
  // The computer's row opens a submenu of its runtimes.
  await pickInRow(page, label, new RegExp(`^${label}.*Claude Code`))
}

async function call(
  stack: Stack,
  method: string,
  path: string,
  body?: unknown,
  token = stack.token,
) {
  const response = await fetch(`${stack.apiUrl}/teams/${stack.teamId}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  return { status: response.status, body: (await response.json().catch(() => ({}))) as never }
}

async function runtimeIds(stack: Stack): Promise<Record<string, string>> {
  const { body } = await call(stack, 'GET', '/agent-runtimes')
  const runtimes = (body as { runtimes: { id: string; label: string }[] }).runtimes

  return Object.fromEntries(runtimes.map((runtime) => [runtime.label, runtime.id]))
}

const fallbacks = async (stack: Stack) =>
  ((await call(stack, 'GET', '/runtime-fallbacks')).body as { fallbacks: Record<string, string> })
    .fallbacks

/** Switches off every other active runtime, leaving the fixture agent's alone; the result switches them back on. */
async function aloneOnFixture(stack: Stack) {
  const { body } = await call(stack, 'GET', '/agent-runtimes')
  const others = (
    body as { runtimes: { id: string; label: string; status: string }[] }
  ).runtimes.filter((runtime) => runtime.label !== FIXTURE && runtime.status === 'active')
  const set = async (status: string) => {
    for (const { id } of others) await call(stack, 'PATCH', `/agent-runtimes/${id}`, { status })
  }

  await set('disabled')

  return () => set('active')
}

const finishedOnSecond = (stack: Stack, marker: string) =>
  agentLog(stack).filter(
    (entry) => entry.agent === 'second' && entry.marker === marker && entry.event === 'finish',
  ).length

export const fallbackSetupScenarios: Scenario[] = [
  {
    name: 'a turn refused for usage sets up its runtime’s fallback from the failure and continues there',
    run: async (page, stack) => {
      const ids = await runtimeIds(stack)
      const marker = 'E2E_DELIVERY:fallback-setup'
      const setUp = page.getByRole('button', { name: 'Set up fallback' })
      const dialog = page.getByRole('dialog', { name: 'Set up fallback' })

      // With no other runtime switched on, nothing can take over: the dialog says so.
      const restore = await aloneOnFixture(stack)

      await page.reload()
      await newTask(page)
      await choose(page, page.getByRole('button', { name: /^Runtime:/ }), FIXTURE)
      await send(page, `Out of usage E2E_USAGE_LIMIT ${marker}`)
      await page
        .getByText('You’ve hit your usage limit')
        .filter({ visible: true })
        .first()
        .waitFor()
      // #3313: Switch runtime opens one runtime list, the one beside this failure.
      await page.getByRole('button', { name: 'Switch runtime' }).first().click()
      await page.getByRole('menu').first().waitFor()
      if ((await page.getByRole('menu').count()) !== 1)
        throw new Error(`Switch runtime opened ${await page.getByRole('menu').count()} lists`)
      await page.keyboard.press('Escape')
      await until(
        'the runtime list to close',
        async () => (await page.getByRole('menu').count()) === 0,
      )
      await setUp.click()
      await dialog.getByText('No other runtime can take over.').waitFor()
      await page.screenshot({ path: `${artifacts}/fallback-none-available.png` })
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await restore()
      await page.reload()

      // The failure offers the setup; nothing is chosen until the person chooses.
      await setUp.waitFor()
      await page.screenshot({ path: `${artifacts}/fallback-offered.png` })
      await setUp.click()
      await dialog.getByText(`For ${FIXTURE} · shared with your team`).waitFor()
      await choose(page, dialog.getByRole('button', { name: /^Runtime:/ }), SECOND)
      // Shot once the runtime list has closed, not while it fades.
      await until(
        'the runtime list to close',
        async () => (await page.getByRole('menu').count()) === 0,
      )
      await page.screenshot({ path: `${artifacts}/fallback-dialog.png` })
      await dialog.getByRole('button', { name: 'Save & switch this Task' }).click()

      // Saved for the team first, then this Task moved through the ordinary move and its turn ran again.
      await page.getByText(`Retrying on ${SECOND}`).waitFor()
      await until('the refused turn to finish on the second agent', async () =>
        Boolean(finishedOnSecond(stack, marker)),
      )
      await page.getByText(`ACK ${marker}`).waitFor()
      if ((await fallbacks(stack))[ids[FIXTURE]!] !== ids[SECOND])
        throw new Error(`The fallback was not saved: ${JSON.stringify(await fallbacks(stack))}`)
      if ((await setUp.count()) > 0) throw new Error('Set up fallback is still offered once saved')
      await page.screenshot({ path: `${artifacts}/fallback-saved-and-moved.png` })
    },
  },
  {
    name: 'with the fallback saved, the next refused turn moves by itself and no setup is offered',
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:fallback-restored'
      const onSecond = () =>
        agentLog(stack).filter((entry) => entry.agent === 'second' && entry.event === 'finish')
          .length
      const before = onSecond()

      await newTask(page)
      await choose(page, page.getByRole('button', { name: /^Runtime:/ }), FIXTURE)
      await send(page, `Out of usage again E2E_USAGE_LIMIT ${marker}`)
      await page.getByText(new RegExp(`so this task moved to ${SECOND}`)).waitFor()
      await until('the turn to go on on the second agent', async () => onSecond() > before)
      if ((await page.getByRole('button', { name: 'Set up fallback' }).count()) > 0)
        throw new Error('A runtime with a fallback still offers to set one up')
      await page.screenshot({ path: `${artifacts}/fallback-restored.png` })
    },
  },
  {
    name: 'a member who does not manage the runtime cannot change its fallback',
    run: async (_page, stack) => {
      const ids = await runtimeIds(stack)
      const member = await joinTeam(stack, 'fallback-member')
      const refused = await call(
        stack,
        'PUT',
        `/runtime-fallbacks/${ids[FIXTURE]}`,
        { fallbackRuntimeId: null },
        member.token,
      )

      if (refused.status !== 403)
        throw new Error(`A member changed a team runtime's fallback: ${String(refused.status)}`)
      if ((await fallbacks(stack))[ids[FIXTURE]!] !== ids[SECOND])
        throw new Error('The refused change cleared the fallback')
      // Later scenarios expect a refused turn to wait for a person.
      await call(stack, 'PUT', `/runtime-fallbacks/${ids[FIXTURE]}`, { fallbackRuntimeId: null })
    },
  },
]
