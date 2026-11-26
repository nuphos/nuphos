// #3273: a question is its card's one-line title; what to decide from goes in its body.
// A long body is cut at a whole line, and Show more opens the rest.
import { must } from './binding-access-scenarios.ts'
import { calledTool } from './computer-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Locator } from 'playwright-core'

/** How many lines of text an element draws. */
const lines = (element: Locator) =>
  element.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
  )

const BODIES: [string, string][] = [
  [
    'Retire the old staging bucket now?',
    [
      '**Why**: the staging bucket has had no writes since the March migration, and the new bucket has served every deploy since then. ',
      'Its lifecycle rule still keeps every object version, so the bill grows each month even though nothing reads it. ',
      'Two dashboards still point at it, both unused for a quarter. ',
      'Retiring it removes the cost and the stale dashboards; restoring from the nightly snapshot takes about ten minutes if anything turns out to need it.',
    ].join(''),
  ],
  [
    '要停用舊的測試儲存桶嗎？',
    '**原因**：測試儲存桶自三月遷移後就沒有任何寫入，新的儲存桶已經接手所有部署。它的生命週期規則仍保留每個物件版本，所以即使沒有人讀取，帳單每月仍在增加。另外有兩個儀表板還指向它，但已經一季沒有人使用。停用後可以省下這筆費用並清掉過時的儀表板；若之後發現仍需要，從每晚快照還原大約十分鐘。停用前會先匯出物件清單與存取紀錄，保存九十天，方便日後查核是誰在什麼時候讀過哪些檔案。兩個儀表板會改指向新的儲存桶，原本的告警規則也一併搬過去，所以值班的同事不需要調整任何設定。如果這週內有人提出異議，可以延後到下個月的維護時段再處理，期間費用會照常計算。',
  ],
]

/** The body's lines of text the box that clips it cuts through, and those it hides entirely. */
const clippedLines = (card: Locator) =>
  card
    .locator('p')
    .first()
    .evaluate((p) => {
      let clip: Element | null = p

      while (clip && getComputedStyle(clip).overflowY === 'visible') clip = clip.parentElement
      const bottom = clip?.getBoundingClientRect().bottom ?? Infinity
      const walker = document.createTreeWalker(p.parentElement!, NodeFilter.SHOW_TEXT)
      const lines: DOMRect[] = []

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange()

        range.selectNodeContents(node)
        lines.push(...[...range.getClientRects()].filter((rect) => rect.height > 0))
      }

      return {
        half: lines.filter((rect) => rect.top < bottom - 1 && rect.bottom > bottom + 1).length,
        hidden: lines.filter((rect) => rect.top >= bottom - 1).length,
      }
    })

export const decisionTitleScenarios: Scenario[] = [
  {
    name: 'a question longer than one line is refused, and its card and the Inbox draw one line',
    run: async (page, stack) => {
      const ask = (question: string, marker: string) => {
        const args = {
          label: 'Ask',
          category: 'approval',
          question,
          body: 'Idle since the migration.',
          options: ['Delete', 'Keep'],
        }

        return send(page, `Ask it E2E_CALL request_user_decision ${JSON.stringify(args)} ${marker}`)
      }

      await newTask(page)
      await ask(
        `Delete the staging cluster? ${'It has been idle for thirty days. '.repeat(4)}`,
        'E2E_DELIVERY:too-long',
      )
      await page.getByText('ACK E2E_DELIVERY:too-long').waitFor()
      const refused = await calledTool(stack, 'request_user_decision')

      must(
        refused.includes('Keep the question to one short line (at most 120 characters)'),
        `a long question to be refused, got ${refused}`,
      )
      // 118 characters: more than one line of the card, which cuts it.
      const question =
        'Delete the staging cluster that has been idle for thirty days, costs forty dollars a day and has no deploys since then?'

      await ask(question, 'E2E_DELIVERY:one-line')
      const card = page.locator(`[data-decision-question="${question}"]:visible h3`)

      await card.waitFor()
      must(
        (await lines(card)) === 1,
        `the card's question to be one line, got ${String(await lines(card))}`,
      )
      await page.getByText('Idle since the migration.').filter({ visible: true }).last().waitFor()
      await page.screenshot({ path: `${artifacts}/decision-one-line-card.png` })

      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.locator('[data-inbox-question]', { hasText: 'Delete the staging cluster' }).click()
      const heading = page.getByRole('heading', { level: 1, name: question })

      await heading.waitFor()
      must(
        (await lines(heading)) === 1,
        `the Inbox question to be one line, got ${String(await lines(heading))}`,
      )
      await page.screenshot({ path: `${artifacts}/decision-one-line-inbox.png` })
    },
  },
  {
    name: 'a long decision body is cut at a whole line and Show more opens the rest',
    run: async (page) => {
      await newTask(page)
      for (const [index, [question, body]] of BODIES.entries()) {
        const args = { label: 'Ask', category: 'approval', question, body, options: ['Yes', 'No'] }

        await send(
          page,
          `Ask it E2E_CALL request_user_decision ${JSON.stringify(args)} E2E_DELIVERY:long-body-${String(index)}`,
        )
        const card = page.locator(`[data-decision-question="${question}"]:visible`).last()

        await card.getByRole('button', { name: 'Yes' }).waitFor()
        const shot = `${artifacts}/decision-body-${String(index)}`

        await card.screenshot({ path: `${shot}-collapsed.png` })
        const collapsed = await clippedLines(card)

        must(collapsed.half === 0, `no line cut through, got ${String(collapsed.half)}`)
        must(collapsed.hidden > 0, 'a body longer than four lines to be cut')
        const more = card.getByRole('button', { name: 'Show more' })

        must(await more.isVisible(), 'a cut body to offer Show more')
        await more.click()
        await card.getByRole('button', { name: 'Show less' }).waitFor()
        const open = await clippedLines(card)

        must(
          open.half + open.hidden === 0,
          `the opened body to show all of it, got ${JSON.stringify(open)}`,
        )
        await card.screenshot({ path: `${shot}-expanded.png` })
      }
    },
  },
]
