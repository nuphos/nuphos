import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('./sidebar-pages.css', import.meta.url), 'utf8')
const list = /(?:^|\n)\.sidebar-page-list \{([^}]*)\}/.exec(css)?.[1] ?? ''

test('a sidebar list reserves more room below its last row than its fade covers (#3429)', () => {
  // The fade and the reserved room read one length, so they can't drift apart again.
  assert.match(list, /padding-bottom:\s*calc\(var\(--sidebar-list-fade\) \+ \d+px\);/)
  assert.match(list, /mask-image:[^;]*calc\(100% - var\(--sidebar-list-fade\)\)/)
})
