import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ReplyQuote } from './ReplyQuote'

// The header row of a pasted CSV: one run with nowhere to break.
const csvHeader =
  'Wave,Video_ID,Title,Publish_Time,Day1_Views,Day1_Browse_Views,Day1_Impressions,Day1_CTR_Pct,Day1_Avg_View_Pct,Day1_AVD_Seconds'

const quote = (mine: boolean) =>
  renderToStaticMarkup(
    <ReplyQuote
      reply={{ id: 'm1', authorName: 'Mei', text: `\`\`\`pasted-text\n${csvHeader}` }}
      mine={mine}
    />,
  )

const classOf = (markup: string, tag: string, nth = 0) =>
  [...markup.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, 'g'))][nth]?.[1].split(' ') ?? []

test('a quote of one long unbroken line wraps and clamps inside its box, in every bubble', () => {
  for (const mine of [true, false]) {
    const markup = quote(mine)
    const box = classOf(markup, 'button')
    const text = classOf(markup, 'span', 1)

    // The box never takes the width of what it quotes.
    assert.ok(box.includes('max-w-[18rem]'), `box is capped (mine=${String(mine)})`)
    assert.ok(box.includes('min-w-0'), 'box can shrink below its content')
    assert.ok(box.includes('overflow-hidden'), 'box clips what is left over')
    // The quoted words break anywhere, then show two lines at most.
    assert.ok(text.includes('[overflow-wrap:anywhere]'), 'a run with no break point still wraps')
    assert.ok(text.includes('w-full'), 'the words take the box width, not their own')
    assert.ok(text.includes('line-clamp-2'), 'at most two lines')
    assert.match(markup, new RegExp(csvHeader))
  }
})

test('a quoted Markdown link reads as its label, not its source', () => {
  for (const mine of [true, false]) {
    const markup = renderToStaticMarkup(
      <ReplyQuote
        reply={{
          id: 'm2',
          authorName: 'Account Manager',
          text: "Handed off to [Rin's Task](https://example.com/teams/abc123/agent/0f3c9e7a-1b2c-4d5e-8f90-123456789abc)",
        }}
        mine={mine}
      />,
    )

    assert.match(markup, /Handed off to Rin&#x27;s Task/)
    assert.doesNotMatch(markup, /example\.com|\]\(/, `no link source (mine=${String(mine)})`)
  }
})
