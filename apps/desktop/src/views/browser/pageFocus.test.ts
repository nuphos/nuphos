import assert from 'node:assert/strict'
import { test } from 'node:test'

import { focusOpenedPage } from './pageFocus.ts'

function page() {
  const calls = { focus: 0 }

  return {
    calls,
    focus: () => {
      calls.focus++
    },
  }
}

const body = {} as HTMLElement
const doc = (activeElement: Element | null) => ({ activeElement, body }) as Document

test('a page opened after the New Tab field unmounted takes the caret', () => {
  const opened = page()

  focusOpenedPage(opened, doc(body))
  assert.equal(opened.calls.focus, 1)

  const fresh = page()

  focusOpenedPage(fresh, doc(null))
  assert.equal(fresh.calls.focus, 1)
})

test('a page opened while the caret is in a field leaves it there', () => {
  const opened = page()

  focusOpenedPage(opened, doc({} as Element))
  assert.equal(opened.calls.focus, 0)
})
