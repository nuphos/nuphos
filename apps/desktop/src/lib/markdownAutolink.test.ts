import assert from 'node:assert/strict'
import test from 'node:test'

import { isSynthesizedAutolink } from './markdownAutolink.ts'

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
