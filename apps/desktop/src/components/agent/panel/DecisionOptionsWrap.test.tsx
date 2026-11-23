import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { DecisionOptions, PILL } from './DecisionOptions'

const long =
  'Stagger the slots (recommended): when a video is ready, schedule it for the next free slot, 12:00 / 15:00 / 18:00 / 21:00'

const classesOf = (markup: string, tag: string) =>
  [...markup.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, 'g'))].map((m) => m[1].split(' '))

const sent: unknown[] = []

test('a long option wraps inside the card, its pill growing taller, and the row wraps', () => {
  const markup = renderToStaticMarkup(
    <DecisionOptions
      questions={[{ question: 'When?', options: [long, 'Publish when ready'], multiSelect: false }]}
      disabled={false}
      typeable
      onSubmit={(answer) => sent.push(answer)}
    />,
  )
  const buttons = classesOf(markup, 'button')

  assert.equal(buttons.length, 3, 'two options and Other…')
  for (const classes of buttons) {
    // Button's own `h-8 whitespace-nowrap` come later in the built CSS, so a plain
    // `h-auto whitespace-normal` loses to them: the pill must force both.
    assert.ok(classes.includes('!whitespace-normal'), 'the label wraps')
    assert.ok(classes.includes('!h-auto'), 'the pill grows with its lines')
    assert.ok(!classes.includes('whitespace-normal'), 'no override that the cascade drops')
    // It never grows past the card, and a word with no break point still wraps.
    assert.ok(classes.includes('max-w-full') && classes.includes('min-w-0'), 'stays in the card')
    assert.ok(classes.includes('[overflow-wrap:anywhere]'), 'breaks a run with no space')
    assert.ok(classes.includes('text-left'), 'wrapped lines read from the left')
  }
  // Pills that do not fit on a line move to the next.
  assert.ok(classesOf(markup, 'div').some((classes) => classes.includes('flex-wrap')))
  assert.match(markup, new RegExp(long.replace(/[()/]/g, '\\$&')))
})

test('Snooze and Dismiss, drawn with the same pill, wrap and grow the same way', () => {
  assert.match(PILL, /!whitespace-normal/)
  assert.match(PILL, /!h-auto/)
})
