// What the leave scenarios share: a teammate's API, the lists, and a row's two menus.
import { artifacts } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Locator, Page } from 'playwright-core'

export function rest(stack: Stack, token: string) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(stack.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()

    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`)

    return (text ? JSON.parse(text) : {}) as T
  }
}

/** The ids one person lists, archived ones left out as the sidebar does. */
export async function listed(
  stack: Stack,
  token: string,
  scope: 'mine' | 'shared',
  kind?: 'channel',
): Promise<string[]> {
  const query = new URLSearchParams({
    teamId: stack.teamId,
    scope,
    archived: 'exclude',
    ...(kind ? { kind } : {}),
  })
  const page = await rest(stack, token)<{ conversations?: { sessionId: string }[] }>(
    'GET',
    `/agent/conversations?${String(query)}`,
  )

  return (page.conversations ?? []).map((conversation) => conversation.sessionId)
}

/** The row's actions, opened from its More button and from a right-click, captured both ways. */
export async function bothMenus(page: Page, row: Locator, title: string, shot: string) {
  const items = () => page.getByRole('menuitem').allTextContents()

  await row.hover()
  await row.getByRole('button', { name: `More actions for ${title}` }).click()
  await page.getByRole('menuitem').first().waitFor()
  const fromButton = await items()

  await page.screenshot({ path: `${artifacts}/${shot}-more-button.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem').first().waitFor({ state: 'detached' })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem').first().waitFor()
  const fromRightClick = await items()

  await page.screenshot({ path: `${artifacts}/${shot}-right-click.png` })
  if (fromButton.join('|') !== fromRightClick.join('|'))
    throw new Error(
      `The More button offers ${fromButton.join(', ')} but a right-click ${fromRightClick.join(', ')}`,
    )

  return fromButton
}

export const rowOf = (page: Page, title: string) =>
  page.locator('aside [data-sidebar-row]').filter({ hasText: title }).first()

export async function stillGoneAfterReload(page: Page, tab: string, title: string) {
  await page.reload()
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForTimeout(2000)
  if ((await page.locator('aside [data-sidebar-row]').filter({ hasText: title }).count()) > 0)
    throw new Error(`"${title}" came back after a reload`)
}
