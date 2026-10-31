import assert from 'node:assert/strict'
import test from 'node:test'

import { dockTabOfWebContents } from './dockTabOfWebContents.ts'

/** A webview whose guest has `id`, inside the dock tab `tab` (or none). */
function webview(id: number, tab?: string) {
  return {
    getWebContentsId: () => id,
    closest: () => (tab ? { dataset: { workspaceTab: tab } } : null),
  }
}

const root = (views: ReturnType<typeof webview>[]) =>
  ({ querySelectorAll: () => views }) as unknown as Pick<ParentNode, 'querySelectorAll'>

test("finds the dock tab holding the guest, in any conversation's dock", () => {
  assert.equal(dockTabOfWebContents(9, root([webview(4, 'a'), webview(9, 'b')])), 'b')
})

test('no guest with that id, or one outside a dock tab, finds nothing', () => {
  assert.equal(dockTabOfWebContents(9, root([webview(4, 'a')])), undefined)
  assert.equal(dockTabOfWebContents(9, root([webview(9)])), undefined)
})
