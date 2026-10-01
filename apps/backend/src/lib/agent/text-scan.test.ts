import { describe, expect, test } from 'bun:test'

import {
  extractBracedObject,
  extractFencedBlock,
  stripTrailingSlashes,
  trimUnderscores,
} from './text-scan'

// The superseded patterns, kept as the oracle: every case below asserts the
// helper agrees with the regex it replaced, so the rewrite is checked against
// the old behaviour rather than against a re-reading of it. Compiled from
// source strings because these are the very backtracking patterns being
// retired, and a literal here would be reported as one.
const oracle = (source: string, flags = ''): RegExp => new RegExp(source, flags)

const TRAILING_SLASHES = oracle('/+$')
const SURROUNDING_UNDERSCORES = oracle('^_+|_+$', 'g')
const BRACED_OBJECT = oracle('\\{[\\s\\S]*\\}')
const FENCED_BLOCK = oracle('```(?:json)?\\s*([\\s\\S]*?)```', 'i')

const SLASH_CASES = [
  '',
  '/',
  '///',
  'https://example.com',
  'https://example.com/',
  'https://example.com///',
  'https://example.com/path/',
  'https://example.com/path//x',
  '/leading',
  'no-slashes-at-all',
]

const UNDERSCORE_CASES = [
  '',
  '_',
  '___',
  'a',
  '_a',
  'a_',
  '_a_',
  '___a_b___',
  'a__b',
  '_',
  '__leading',
  'trailing__',
]

const BRACED_CASES = [
  '',
  'no braces here',
  '{}',
  '{"a":1}',
  'prefix {"a":1} suffix',
  'prefix {"a":{"b":2}} suffix',
  '} {',
  '{ unterminated',
  'unopened }',
  '{"a":1} then {"b":2}',
  'text\nwith\nnewlines {"a":\n1}\nafter',
  '{{}}',
]

const FENCE_CASES = [
  '',
  'no fence',
  '```json\n[1,2]\n```',
  '```JSON\n[1,2]\n```',
  '```\n[1,2]\n```',
  '```[1,2]```',
  '```json[1,2]```',
  '```jsonx```',
  '``````',
  '```json\n[1]\n``` trailing',
  'lead ```json  \n[1]\n```',
  '```unterminated',
  '```json\nunterminated',
]

describe('stripTrailingSlashes', () => {
  for (const input of SLASH_CASES) {
    test(`matches the regex for ${JSON.stringify(input)}`, () => {
      expect(stripTrailingSlashes(input)).toBe(input.replace(TRAILING_SLASHES, ''))
    })
  }
})

describe('trimUnderscores', () => {
  for (const input of UNDERSCORE_CASES) {
    test(`matches the regex for ${JSON.stringify(input)}`, () => {
      expect(trimUnderscores(input)).toBe(input.replace(SURROUNDING_UNDERSCORES, ''))
    })
  }
})

describe('extractBracedObject', () => {
  for (const input of BRACED_CASES) {
    test(`matches the regex for ${JSON.stringify(input)}`, () => {
      expect(extractBracedObject(input)).toBe(BRACED_OBJECT.exec(input)?.[0] ?? null)
    })
  }
})

describe('extractFencedBlock', () => {
  for (const input of FENCE_CASES) {
    test(`matches the regex for ${JSON.stringify(input)}`, () => {
      expect(extractFencedBlock(input)).toBe(FENCED_BLOCK.exec(input)?.[1] ?? null)
    })
  }
})

describe('stays linear on adversarial input', () => {
  test('no catastrophic backtracking on long unterminated input', () => {
    const started = Date.now()

    stripTrailingSlashes(`${'/'.repeat(50_000)}x`)
    trimUnderscores(`${'_'.repeat(50_000)}x`)
    extractBracedObject(`${'{'.repeat(50_000)}x`)
    extractFencedBlock('```'.repeat(1) + 'a'.repeat(50_000))
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
