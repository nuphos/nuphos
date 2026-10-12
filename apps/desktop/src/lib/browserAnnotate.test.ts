import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatPickedElement } from './browserAnnotate.ts'

test('picked element becomes composer text with a fenced html block', () => {
  assert.equal(
    formatPickedElement({
      url: 'https://example.com/a',
      selector: '#app > button:nth-of-type(2)',
      html: '<button>Save</button>',
    }),
    [
      'Element on https://example.com/a',
      'Selector: #app > button:nth-of-type(2)',
      '```html',
      '<button>Save</button>',
      '```',
      '',
    ].join('\n'),
  )
})

test('page html cannot close the fence or flood the composer', () => {
  const text = formatPickedElement({
    url: 'https://example.com',
    selector: 'div',
    html: `<pre>\`\`\`\`</pre>${'x'.repeat(2000)}`,
  })

  assert.ok(text.includes('\n`````html\n'))
  assert.ok(text.endsWith('…\n`````\n'))
  assert.ok(text.length < 800)
})
