import assert from 'node:assert/strict'
import test from 'node:test'

import { isSynthesizedAutolink, remarkEndBareUrls } from './markdownAutolink.ts'

test('a bare www./domain literal got its http:// from GFM, not the author', () => {
  assert.equal(
    isSynthesizedAutolink('http://www.ads.spbussiness.com', 'www.ads.spbussiness.com'),
    true,
  )
  assert.equal(isSynthesizedAutolink('http://ads.spbussiness.com', 'ads.spbussiness.com'), true)
  assert.equal(isSynthesizedAutolink('mailto:owner@example.com', 'owner@example.com'), true)
})

test('a normalized href still reads as synthesized — the text is what tells us', () => {
  // GFM autolinks the CJK tail too, and the href comes back IDN-punycoded with
  // a trailing slash. Comparing href to text would miss this one.
  assert.equal(
    isSynthesizedAutolink(
      'http://www.ads.spbussiness.xn--com,-3k9hx3gpe/',
      'www.ads.spbussiness.com，有效期',
    ),
    true,
  )
})

test('a literal that carries its own scheme is a deliberate link', () => {
  assert.equal(
    isSynthesizedAutolink(
      'https://console.aws.amazon.com/ec2',
      'https://console.aws.amazon.com/ec2',
    ),
    false,
  )
  assert.equal(isSynthesizedAutolink('http://legacy.internal', 'http://legacy.internal'), false)
  assert.equal(isSynthesizedAutolink('mailto:owner@example.com', 'mailto:owner@example.com'), false)
})

test('an explicit [label](url) keeps its link', () => {
  assert.equal(isSynthesizedAutolink('https://nuphos.ai/x', '控制台'), false)
  assert.equal(isSynthesizedAutolink('https://docs.nuphos.ai/setup', 'the setup guide'), false)
  assert.equal(isSynthesizedAutolink('mailto:support@nuphos.ai', '寄信給我們'), false)
})

test('a nuphos mention link is never mistaken for a bare literal', () => {
  assert.equal(
    isSynthesizedAutolink('https://nuphos.ai/plan/abc', 'https://nuphos.ai/plan/abc'),
    false,
  )
})

test('surrounding whitespace from streaming word spans does not defeat the match', () => {
  assert.equal(isSynthesizedAutolink('http://www.example.com', ' www.example.com '), true)
})

test('empty link text is left alone', () => {
  assert.equal(isSynthesizedAutolink('http://www.example.com', '   '), false)
})

// The paragraph GFM parses around a bare URL: the link runs on to the next ASCII space.
function endBareUrl(literal: string, url = literal) {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'link', url, children: [{ type: 'text', value: literal }] }],
      },
    ],
  }

  remarkEndBareUrls()(tree)

  return tree.children[0]?.children
}

const link = (url: string, text = url) => ({
  type: 'link',
  url,
  children: [{ type: 'text', value: text }],
})

test('a bare URL ends before full-width punctuation', () => {
  const pr = 'https://github.com/nuphos/nuphos/pull/2595'

  assert.deepEqual(endBareUrl(`${pr}（Fixes`), [link(pr), { type: 'text', value: '（Fixes' }])
  assert.deepEqual(endBareUrl(`${pr}，下一句`), [link(pr), { type: 'text', value: '，下一句' }])
  assert.deepEqual(endBareUrl(`${pr}。`), [link(pr), { type: 'text', value: '。' }])
  assert.deepEqual(endBareUrl(`${pr}\u3000next`), [link(pr), { type: 'text', value: '\u3000next' }])
  assert.deepEqual(endBareUrl('www.example.com、b', 'http://www.example.com、b'), [
    link('http://www.example.com', 'www.example.com'),
    { type: 'text', value: '、b' },
  ])
})

test('CJK letters, ASCII punctuation and explicit labels stay in the link', () => {
  for (const url of ['https://zh.wikipedia.org/wiki/台灣', 'https://example.com/a?b=c,d']) {
    assert.deepEqual(endBareUrl(url), [link(url)])
  }
  assert.deepEqual(endBareUrl('看這裡，', 'https://example.com'), [
    link('https://example.com', '看這裡，'),
  ])
})
