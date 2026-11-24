// #1914: the agent asks for a website form's details in one secure card and enters them
// itself. The form is a page served from this computer, and it reports every value an
// input receives, so the scenario sees what really reached which page.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { agentEvents, agentLog } from './agent-log.ts'
import { freePorts, logPath, until } from './processes.ts'
import { pickAgent } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

// The runtime image's `panel` job: how the backend puts a file on a runtime and reads one back.
const PANEL_JOB = resolve(import.meta.dirname, '../../apps/runtime/image/panel-job.mjs')
const ID = 'E2E-ID-48213-form'
const BIRTH = '1990-04-12-form'

const FORM = `<!doctype html><title>Lookup</title>
<input id="E2E_ID"><input id="E2E_BIRTH">
<script>
for (const input of document.querySelectorAll('input'))
  input.addEventListener('input', () =>
    fetch('/seen', { method: 'POST', body: JSON.stringify({ id: input.id, value: input.value }) }))
</script>`

type Seen = { host: string; id: string; value: string }

/** Serves the form on every loopback name, and keeps what its inputs received and under which host. */
function serveForm(port: number): { seen: Seen[]; close: () => void } {
  const seen: Seen[] = []
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('content-type', 'text/html')
      response.end(FORM)

      return
    }
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      seen.push({ host: request.headers.host ?? '', ...(JSON.parse(body) as Omit<Seen, 'host'>) })
      response.end()
    })
  })

  server.listen(port)

  return { seen, close: () => server.close() }
}

// The card on screen: a Task opened before stays in the page, hidden, with its own card.
const field = (page: Page, label: string) => page.getByLabel(label).filter({ visible: true })

export const formScenario = {
  // The card's reply is sent from a transcript the app is one turn behind on: the backend
  // answers 409 once, and the app reloads the transcript and sends the reply again.
  expected: /transcript_out_of_sync/,
  name: "the agent asks for a form's details in one card and fills them in, only on the site the card named",
  run: async (page: Page, stack: Stack) => {
    const [port] = await freePorts(1)
    const site = `localhost:${String(port)}`
    const form = serveForm(port!)
    const events = () => agentLog(stack).filter((entry) => entry.event.startsWith('fill'))

    try {
      // Saving a value and reading it back go through the runtime's `panel` job. The agent host
      // offers it from here on only: with it, the backend also reads a runtime's models another way.
      await stack.restartAgentHost(undefined, `panel=${process.execPath} ${PANEL_JOB}`)
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      // An earlier scenario may have left the other agent as the one a new Task starts on, and
      // the host restarted above is listed again a moment later: that redraw closes an open
      // submenu, and nothing reopens it, so a pick it catches starts over on a fresh menu.
      await until(
        'the fixture agent to be picked',
        async () => {
          try {
            await pickAgent(page, 'E2E fixture agent')

            return true
          } catch (error) {
            // Closes the submenu, then the menu.
            await page.keyboard.press('Escape')
            await page.keyboard.press('Escape')
            throw error
          }
        },
        180_000,
      )
      await page.getByRole('textbox', { name: 'Message' }).click()
      await page.keyboard.type(`fill the form E2E_FORM:${site} E2E_DELIVERY:form`)
      await page.keyboard.press('Enter')

      await page.getByText(`Details needed for ${site}`).waitFor()
      // #3397: the person types while the agent's turn still runs, and the turn ends under them.
      await field(page, 'ID number').fill(ID)
      await field(page, 'Date of birth').fill(BIRTH)
      await until('the asking turn to end', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:form'),
      )
      // The Nuphos browser runs on this computer, so the person lets the Task use it.
      // An earlier scenario's Task keeps its own composer, inert, behind this one.
      await page.locator('button[title^="Computers"]:not([inert])').last().click()
      const all = page.getByRole('menu').getByRole('switch')

      await all.waitFor()
      // A new Task starts on All, which already lets it use this computer.
      if ((await all.getAttribute('aria-checked')) !== 'true') await all.click()
      await page.keyboard.press('Escape')
      // The app takes the stored transcript within a second of the turn's end, and nothing on
      // the page says when. After it, the card is still the card that was typed in.
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const kept =
        (await field(page, 'ID number').inputValue()) === ID &&
        (await field(page, 'Date of birth').inputValue()) === BIRTH

      if (!kept) throw new Error('The card lost what was typed when the turn ended')
      await page.getByRole('button', { name: 'Send securely' }).click()
      // Submitting the card is all the person does: the agent carries on from the saved files.
      await until('the agent to fill the form', async () => events().length === 2)

      const [elsewhere, filled] = events()

      // Same page, same port, another host name: another origin, so nothing is entered there.
      if (!elsewhere?.detail?.includes('Nothing was entered'))
        throw new Error(`A tab off the card's site was not refused: ${elsewhere?.detail ?? ''}`)
      if (filled?.isError || filled?.detail?.includes('"filled\\":false'))
        throw new Error(`The form was not filled: ${filled?.detail ?? ''}`)
      await until('the form to receive both values', async () => form.seen.length >= 2)
      const got = Object.fromEntries(form.seen.map((entry) => [entry.id, entry.value]))

      if (got.E2E_ID !== ID || got.E2E_BIRTH !== BIRTH)
        throw new Error(`The form received other values: ${JSON.stringify(form.seen)}`)
      if (form.seen.some((entry) => entry.host !== site))
        throw new Error(`A value reached a page off the card's site: ${JSON.stringify(form.seen)}`)

      // The values went from the card to the page. The agent, its log, the conversation on
      // screen and the backend's log never held them.
      const places = {
        'what the agent saw': readFileSync(stack.acpLog, 'utf8'),
        'the conversation': await page.locator('body').innerText(),
        'the backend log': readFileSync(logPath('backend'), 'utf8'),
      }

      for (const [place, text] of Object.entries(places))
        if (text.includes(ID) || text.includes(BIRTH))
          throw new Error(`A value the person typed is in ${place}`)
    } finally {
      form.close()
    }
  },
}
