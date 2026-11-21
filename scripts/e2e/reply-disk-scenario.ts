// A reply preview and a runtime warning must occupy separate space in a real Desktop chat.
import { join } from 'node:path'

import { laptopOnline, LAPTOP } from './laptop-fixture.ts'
import { artifacts } from './processes.ts'
import { pickInSubmenu } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

export async function replyDiskScenario(page: Page, stack: Stack) {
  const online = await laptopOnline(stack, { diskPercent: 91 })
  const originalSize = page.viewportSize()
  let switched = false
  let deletionStatus: number
  let deletionOk: boolean
  const warning = page.getByRole('status').filter({ hasText: 'disk is almost full (91%)' })
  const row = page
    .locator('.group\\/post')
    .filter({ hasText: 'POSTED E2E_DELIVERY:missing' })
    .last()
  const cancel = page.getByRole('button', { name: 'Cancel reply' })
  const editor = page.locator('[contenteditable="true"]').last()
  const showReply = async () => {
    await row.hover()
    await row.getByRole('button', { name: 'Reply', exact: true }).click()
    await cancel.waitFor()
  }

  try {
    await showReply()
    if (!(await editor.isVisible())) throw new Error('Composer is not visible without a warning')
    await cancel.click()
    await cancel.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: /^Runtime:/ }).click()
    await page.getByRole('menu').getByText(LAPTOP).first().click()
    await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
    switched = true
    await warning.waitFor({ timeout: 60_000 })
    for (const [name, width] of [
      ['normal', 1280],
      ['narrow', 720],
    ] as const) {
      await page.setViewportSize({ width, height: 760 })
      await showReply()
      await editor.fill('A fictional reply')
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, `reply-disk-${name}.png`) })
      const preview = page
        .getByText(/^Replying to /)
        .locator('..')
        .locator('..')
      const [p, w, e, c] = await Promise.all([
        preview.boundingBox(),
        warning.boundingBox(),
        editor.boundingBox(),
        cancel.boundingBox(),
      ])

      if (!p || !w || !e || !c) throw new Error('A required control has no visible box')
      if (p.y + p.height > w.y + 1 || w.y + w.height > e.y + 1)
        throw new Error(
          `Overlapping reply, warning or editor at ${name}: ${JSON.stringify({ p, w, e })}`,
        )
      await cancel.click()
      await cancel.waitFor({ state: 'hidden' })
      if (!(await warning.isVisible()) || !(await editor.isVisible()))
        throw new Error('Warning or composer disappeared after cancel')
    }
    console.log('PASS reply preview and low disk warning at normal and narrow widths')
  } finally {
    await page.keyboard.press('Escape')
    await editor.fill('')
    if (originalSize) await page.setViewportSize(originalSize)
    if (switched) {
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      await page.getByRole('menu').getByText('E2E fixture agent').first().click()
      await pickInSubmenu(
        page,
        page.getByRole('menuitem', { name: /^E2E fixture agent.*Claude Code/ }).last(),
      )
    }
    online()
    const deleted = await fetch(`${stack.apiUrl}/agent/devices/e2e-laptop`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${stack.token}` },
    })

    deletionStatus = deleted.status
    deletionOk = deleted.ok
  }
  if (!deletionOk) throw new Error(`Removing the fixture laptop failed: ${deletionStatus}`)
}
