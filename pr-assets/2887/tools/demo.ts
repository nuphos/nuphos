// Local only (not committed): real backend + Desktop + fixture agent, for #2879 screenshots.
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

import type { Page } from 'playwright-core'

const OUT = process.env.SHOTS ?? `${artifacts}/shots`
const Q = 'Publish the v2.4 release notes as drafted?'
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('SHOT', name)
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).last().click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
async function newTask(page: Page) {
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task', exact: true }).click()
}

const { mkdirSync } = await import('node:fs')
mkdirSync(OUT, { recursive: true })
const stack = await startStack()
const desktop = await startDesktop(stack.apiUrl)
const page = desktop.page
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(stack.apiUrl + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${stack.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${path} ${String(r.status)} ${await r.text()}`)
  return r.json() as Promise<any>
}
const sessions = async () =>
  (await api('GET', `/agent/conversations?teamId=${stack.teamId}&limit=50`)) as any

try {
  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await page.reload()
  await page.locator('input[type=email]').fill(stack.email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
  await page.getByText('Start with your first Bot').waitFor()

  // A Bot, with one exchange so its chat is not empty.
  await page.getByRole('button', { name: 'New Bot' }).last().click()
  await page.locator('input[aria-label="Agent name"]').fill('Release Bot')
  await page.getByRole('button', { name: 'Create', exact: true }).click({ force: true })
  await page.getByText('Everyone here sees each message').waitFor()
  await send(page, "Let's cut v2.4 today. Draft the release notes and check the changelog. E2E_DELIVERY:bot")
  await page.waitForTimeout(4000)

  // A Task asks: the card in the Task itself, with no source line.
  await newTask(page)
  await send(page, 'Draft the v2.4 release notes E2E_ASK E2E_DELIVERY:task')
  await page.getByRole('heading', { name: Q }).last().waitFor()
  await page.getByText('ACK E2E_DELIVERY:task').waitFor()
  await shot(page, 'task')
  await page.getByRole('button', { name: 'Other…' }).last().click()
  await page.keyboard.type('Publish after marketing confirms the name')
  await shot(page, 'task-other')
  await page.keyboard.press('Escape')

  // A long body: four lines, the fade and "Show more".
  await newTask(page)
  await send(page, 'Draft the v2.4 release notes E2E_ASK E2E_LONG E2E_DELIVERY:long')
  await page.getByRole('heading', { name: Q }).last().waitFor()
  await page.getByText('ACK E2E_DELIVERY:long').waitFor()
  await shot(page, 'task-long')
  await page.getByRole('button', { name: 'Show more' }).last().click()
  await shot(page, 'task-long-expanded')

  // The first Task under the Bot: its question shows in the Bot's chat with a source line.
  const list = await sessions()
  const items: any[] = list.conversations ?? list.items ?? list
  console.log('sessions', items.map((s: any) => `${s.sessionId}:${s.title}:${s.kind ?? ''}`).join(' | '))
  const bot = items.find((s: any) => s.title === 'Release Bot')
  const task = items.find((s: any) => /E2E_DELIVERY:task/.test(JSON.stringify(s)) || s.title?.includes('Draft the v2.4') ) 
  if (bot && task) {
    await api('PUT', `/agent/conversations/${task.sessionId}/parent`, { parentSessionId: bot.sessionId, teamId: stack.teamId })
    await page.getByRole('tab', { name: 'Bots' }).click()
    await page.getByText('Release Bot').first().click()
    await page.getByRole('heading', { name: Q }).last().waitFor()
    await shot(page, 'bot-chat')
    await page.getByRole('button', { name: 'Other…' }).last().click()
    await page.keyboard.type('Publish after marketing confirms the name')
    await shot(page, 'bot-chat-other')
  } else console.log('NO BOT/TASK', Boolean(bot), Boolean(task))
  console.log('DONE')
  await new Promise((r) => setTimeout(r, Number(process.env.HOLD_MS ?? 0)))
} catch (error) {
  console.error(error)
  await page.screenshot({ path: `${OUT}/fail.png` }).catch(() => {})
} finally {
  await desktop.close()
  await stopAll()
}
process.exit(0)
