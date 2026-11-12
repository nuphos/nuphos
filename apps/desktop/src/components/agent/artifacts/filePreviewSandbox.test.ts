import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ARTIFACT_FRAME_SANDBOX } from './artifactSandbox.ts'
import { FILE_PREVIEW_CSP, FILE_PREVIEW_SANDBOX, filePreviewSrcDoc } from './filePreviewSandbox.ts'

// No DOM in node: a document with no hint links, as DOMParser gives for these files.
const noHints = () => ({ querySelectorAll: () => [] }) as unknown as Document

test('a file preview gets no sandbox flag at all', () => {
  assert.equal(FILE_PREVIEW_SANDBOX, '')
  assert.doesNotMatch(FILE_PREVIEW_SANDBOX, /allow-/)
})

test('artifacts keep their own, looser sandbox', () => {
  assert.equal(ARTIFACT_FRAME_SANDBOX, 'allow-scripts allow-popups allow-forms allow-modals')
})

test('the policy refuses every network load', () => {
  const directives = new Map(
    FILE_PREVIEW_CSP.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)

      return [name, values.join(' ')] as const
    }),
  )

  assert.equal(directives.get('default-src'), "'none'")
  assert.equal(directives.get('img-src'), 'data:')
  assert.equal(directives.get('style-src'), "'unsafe-inline'")
  assert.equal(directives.get('font-src'), 'data:')
  assert.equal(directives.get('base-uri'), "'none'")
  assert.equal(directives.get('form-action'), "'none'")
  // Nothing names a host, a scheme that reaches one, or lets script run.
  assert.doesNotMatch(FILE_PREVIEW_CSP, /https?:|\*|'unsafe-eval'|script-src|connect-src/)
})

function headOf(doc: string): string {
  return doc.slice(0, doc.search(/<\/head>|<body|<h1|<p>/i))
}

test('the policy leads the head, ahead of anything the file loads', () => {
  const doc = filePreviewSrcDoc(
    '<!doctype html><html><head><link rel="stylesheet" href="https://x.test/a.css"></head><body><img src="https://x.test/t.png"></body></html>',
    noHints,
  )
  const policy = doc.indexOf('Content-Security-Policy')

  assert.ok(policy > 0)
  assert.ok(policy < doc.indexOf('https://x.test/a.css'))
  assert.match(doc, /<base target="_blank">/)
})

test('a fragment is given a document with the policy in its head', () => {
  const doc = filePreviewSrcDoc('<h1>Report</h1><script>alert(1)</script>')

  assert.match(headOf(doc), /Content-Security-Policy/)
  assert.match(doc, /<body><h1>Report<\/h1>/)
})

test('the file preview adds no script of its own', () => {
  const doc = filePreviewSrcDoc('<p>hi</p>')

  assert.doesNotMatch(doc, /<script/i)
})
