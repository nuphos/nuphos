import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ReplyQuote } from './ReplyQuote'

// The header row of a pasted CSV: one run with nowhere to break.
const csvHeader =
  'Wave,Video_ID,Title,Publish_Time,Day1_Views,Day1_Browse_Views,Day1_Impressions,Day1_CTR_Pct,Day1_Avg_View_Pct,Day1_AVD_Seconds'

const quote = (mine: boolean, standalone = false) =>
  renderToStaticMarkup(
    <ReplyQuote
      reply={{ id: 'm1', authorName: 'Mei', text: `\`\`\`pasted-text\n${csvHeader}` }}
      mine={mine}
      standalone={standalone}
    />,
  )

const classOf = (markup: string, tag: string, nth = 0) =>
  [...markup.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, 'g'))][nth]?.[1].split(' ') ?? []

test('a quote of one long unbroken line wraps and clamps inside its box, in every bubble', () => {
  for (const [mine, standalone] of [
    [true, false],
    [false, false],
    [false, true],
  ]) {
    const markup = quote(mine, standalone)
    const box = classOf(markup, 'button')
    const text = classOf(markup, 'span', 1)

    // The box never takes the width of what it quotes: in a bubble its width is
    // contained, above files alone it is capped.
    const contained = standalone
      ? box.includes('max-w-[18rem]')
      : box.includes('[contain:inline-size]')

    assert.ok(
      contained,
      `box ignores its content's width (mine=${String(mine)}, standalone=${String(standalone)})`,
    )
    assert.ok(box.includes('overflow-hidden'), 'box clips what is left over')
    // The quoted words break anywhere, then show two lines at most.
    assert.ok(text.includes('[overflow-wrap:anywhere]'), 'a run with no break point still wraps')
    assert.ok(text.includes('w-full'), 'the words take the box width, not their own')
    assert.ok(text.includes('line-clamp-2'), 'at most two lines')
    assert.match(markup, new RegExp(csvHeader))
  }
})

test("in a bubble the quote's minimum follows the message row, so a narrow pane shrinks it", () => {
  const box = classOf(quote(false), 'button')

  // 15rem at most, and never wider than the row (an inline-size container) less
  // the avatar, the reply button's room, gaps and bubble padding.
  assert.ok(box.includes('min-w-[min(15rem,calc(100cqw-6rem))]'), box.join(' '))
  assert.ok(!box.includes('max-w-[18rem]'), 'no cap inside a bubble')
  assert.ok(!box.includes('min-w-0'), 'the cqw minimum is not overridden')
})

test('above files alone the quote keeps its modest cap and can shrink', () => {
  const box = classOf(quote(false, true), 'button')

  assert.ok(box.includes('max-w-[18rem]'))
  assert.ok(box.includes('min-w-0'))
  assert.ok(!box.some((c) => c.includes('cqw')), 'no bubble row to measure')
})
