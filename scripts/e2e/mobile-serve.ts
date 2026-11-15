// Local only, not part of the suite: the e2e stack kept running for a phone to use. The Desktop
// app signs in and, on request, starts a Task whose agent asks for a form's details; a small
// helper answers what a phone test cannot read from this computer.
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { startDesktop } from './desktop.ts'
import { artifacts } from './processes.ts'
import { startStack } from './stack.ts'
import { newTask, send } from './ui.ts'

const stack = await startStack()
const desktop = await startDesktop(stack.apiUrl)
const page = desktop.page

page.setDefaultTimeout(60_000)
await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
await page.reload()
await page.locator('input[type=email]').fill(stack.email)
await page.getByRole('button', { name: 'Continue with email' }).click()
await page.getByText('Enter the 6-digit code').waitFor()
await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
await page.getByText('Start with your first Bot').waitFor()

const api = async (path: string) =>
  (await fetch(stack.apiUrl + path, { headers: { authorization: `Bearer ${stack.token}` } })).json()

/** The Desktop app starts a Task whose agent asks for the form's details; resolves once the card is drawn. */
async function ask(site: string, marker: string) {
  await newTask(page)
  await send(page, `fill the form E2E_FORM:${site} E2E_DELIVERY:${marker}`)
  await page.getByText(`Details needed for ${site}`).waitFor()
  const list = (await api(`/agent/conversations?teamId=${stack.teamId}`)) as {
    conversations: { sessionId: string; firstMessage?: string }[]
  }

  return list.conversations.find((c) => c.firstMessage?.includes(marker))?.sessionId
}

const port = Number(process.env.HELPER_PORT ?? 18914)

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://helper')
  const reply = (body: unknown) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(body))
  }

  if (url.pathname === '/code') reply({ code: stack.signInCode(url.searchParams.get('email') ?? '') })
  else if (url.pathname === '/log') reply(agentLog(stack))
  else if (url.pathname === '/ask')
    ask(url.searchParams.get('site') ?? 'www.clinic.example', url.searchParams.get('marker') ?? 'form').then(
      (sessionId) => reply({ sessionId, teamId: stack.teamId }),
      (error: unknown) => reply({ error: String(error) }),
    )
  else reply({ apiUrl: stack.apiUrl, email: stack.email, teamId: stack.teamId, artifacts })
}).listen(port, '127.0.0.1')

writeFileSync(
  join(artifacts, 'state.json'),
  JSON.stringify({ apiUrl: stack.apiUrl, email: stack.email, teamId: stack.teamId, helper: port }),
)
console.log(`READY ${stack.apiUrl} helper ${String(port)} ${stack.email}`)
