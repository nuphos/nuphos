import assert from 'node:assert/strict'
import { test } from 'node:test'

import { filePreviewSrcDoc } from './filePreviewSandbox.ts'
import { isHintRel, serializeDocument, stripResourceHints } from './resourceHints.ts'

// Node has no DOMParser, so these tests hand stripResourceHints a document
// shaped like the one it would parse: markup pieces, some of them <link>s.
type Piece = string | { rel: string | null; html: string }

function fakeParser(pieces: Piece[], doctype: Partial<DocumentType> | null = { name: 'html' }) {
  const removed = new Set<Piece>()
  const links = pieces.flatMap((piece) =>
    typeof piece === 'string'
      ? []
      : [{ getAttribute: () => piece.rel, remove: () => removed.add(piece) }],
  )
  const doc = {
    doctype: doctype && { publicId: '', systemId: '', ...doctype },
    documentElement: {
      get outerHTML() {
        return pieces
          .filter((piece) => !removed.has(piece))
          .map((piece) => (typeof piece === 'string' ? piece : piece.html))
          .join('')
      },
    },
    querySelectorAll: () => links,
  }
  let calls = 0
  const parse = () => {
    calls++

    return doc as unknown as Document
  }

  return { parse, calls: () => calls }
}

test('every hint rel counts, in any case and among other values', () => {
  for (const rel of [
    'dns-prefetch',
    'preconnect',
    'prefetch',
    'prerender',
    'preload',
    'modulepreload',
    'DNS-Prefetch',
    'icon preconnect',
    '  stylesheet\tdns-prefetch\n',
  ]) {
    assert.equal(isHintRel(rel), true, rel)
  }
  for (const rel of [null, '', 'stylesheet', 'icon', 'preconnecting', 'preconnect/href=//x.test']) {
    assert.equal(isHintRel(rel), false, String(rel))
  }
})

test('hint links are removed from the parsed document and the rest is kept', () => {
  const { parse } = fakeParser([
    '<html><head>',
    { rel: 'dns-prefetch', html: '<link rel="dns-prefetch" href="//evil.test">' },
    { rel: 'stylesheet', html: '<link rel="stylesheet" href="https://x.test/a.css">' },
    { rel: 'icon preconnect', html: '<link rel="icon preconnect" href="//evil.test">' },
    '</head><body><p>Hi</p></body></html>',
  ])

  assert.equal(
    stripResourceHints('<link rel="dns-prefetch" href="//evil.test">…', parse),
    '<!DOCTYPE html><html><head><link rel="stylesheet" href="https://x.test/a.css"></head><body><p>Hi</p></body></html>',
  )
})

test('a file with no hint is passed through exactly as written', () => {
  const html =
    '<!doctype html>\n<p title="1 < 2">a <b>link</b></p><link rel="stylesheet" href="a.css">'
  const { parse, calls } = fakeParser([{ rel: 'stylesheet', html: '' }])

  assert.equal(stripResourceHints(html, parse), html)
  assert.equal(calls(), 1)
})

test('markup that never mentions "link" is not even parsed', () => {
  const { parse, calls } = fakeParser([])

  assert.equal(stripResourceHints('<p>Hello</p>', parse), '<p>Hello</p>')
  assert.equal(calls(), 0)
})

test('the doctype, and so the rendering mode, survives serialization', () => {
  const root = { outerHTML: '<html></html>' }

  assert.equal(
    serializeDocument({ doctype: null, documentElement: root } as never),
    '<html></html>',
  )
  assert.equal(
    serializeDocument({
      doctype: {
        name: 'html',
        publicId: '-//W3C//DTD HTML 4.01//EN',
        systemId: 'http://w3.test/s.dtd',
      },
      documentElement: root,
    } as never),
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://w3.test/s.dtd"><html></html>',
  )
  assert.equal(
    serializeDocument({
      doctype: { name: 'html', publicId: '', systemId: 'about:legacy-compat' },
      documentElement: root,
    } as never),
    '<!DOCTYPE html SYSTEM "about:legacy-compat"><html></html>',
  )
})

test('1 MB of unterminated tags is handled in well under a second', () => {
  // The hand-written tokenizer this replaces took ~51 s on 120 KB of these.
  const { parse } = fakeParser(['<html><head></head><body></body></html>'])

  for (const unit of ['<a ', '<a b="', '<a <link rel="preconnect" ']) {
    const html = unit.repeat(Math.ceil(1_000_000 / unit.length))
    const started = performance.now()

    stripResourceHints(html, parse)
    const ms = performance.now() - started

    assert.ok(ms < 500, `${JSON.stringify(unit)}: ${ms.toFixed(1)} ms`)
  }
})

test('the srcdoc has no hints and still leads its head with the CSP', () => {
  const { parse } = fakeParser([
    '<html><head>',
    { rel: 'dns-prefetch', html: '<link rel="dns-prefetch" href="//evil.test">' },
    { rel: 'stylesheet', html: '<link rel="stylesheet" href="https://x.test/a.css">' },
    '</head><body><p>Hi</p></body></html>',
  ])
  const doc = filePreviewSrcDoc('<link rel="dns-prefetch" href="//evil.test"><p>Hi</p>', parse)
  const policy = doc.indexOf('Content-Security-Policy')

  assert.ok(doc.startsWith('<!DOCTYPE html><html><head>'))
  assert.doesNotMatch(doc, /evil\.test/)
  assert.ok(policy > 0 && policy < doc.indexOf('https://x.test/a.css'))
  assert.ok(doc.indexOf('<head>') < policy)
  assert.ok(policy < doc.indexOf('x-dns-prefetch-control'))
  assert.match(doc, /<meta http-equiv="x-dns-prefetch-control" content="off">/)
  assert.match(doc, /<body><p>Hi<\/p><\/body>/)
})
