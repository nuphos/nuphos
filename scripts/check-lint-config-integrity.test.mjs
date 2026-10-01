import assert from 'node:assert/strict'
import test from 'node:test'

import { Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'

import {
  auditRule,
  collectRuleImplementations,
  handWrittenBlocks,
  severityOf,
  visitorKeys,
} from './check-lint-config-integrity.mjs'

const live = unicorn.rules['prefer-single-call']
const stub = unicorn.rules['no-array-push-push']

test('severityOf normalizes both spellings and unwraps options', () => {
  assert.equal(severityOf('off'), 0)
  assert.equal(severityOf(0), 0)
  assert.equal(severityOf(['warn', { max: 15 }]), 1)
  assert.equal(severityOf(['error']), 2)
  assert.equal(severityOf('nonsense'), null)
})

test('handWrittenBlocks keeps unnamed rule blocks and drops presets', () => {
  const blocks = handWrittenBlocks([
    { name: 'globalIgnores', ignores: ['dist'] },
    { name: 'sonarjs/recommended', rules: { 'sonarjs/no-dead-store': 'warn' } },
    { rules: {} },
    { rules: { yoda: 'warn' } },
  ])

  assert.deepEqual(blocks, [{ rules: { yoda: 'warn' } }])
})

test('collectRuleImplementations merges core rules with every plugin in the array', () => {
  const impls = collectRuleImplementations(
    [{ plugins: { unicorn } }, { plugins: {} }],
    new Map([['curly', { create: () => ({}) }]]),
  )

  assert.equal(impls.get('unicorn/prefer-single-call'), live)
  assert.ok(impls.has('curly'))
})

test('visitorKeys sees a live rule register a visitor', () => {
  assert.deepEqual(visitorKeys(live, ['warn'], Linter), ['CallExpression'])
})

test('visitorKeys sees a deprecated stub register nothing', () => {
  assert.deepEqual(visitorKeys(stub, ['warn'], Linter), [])
})

test('visitorKeys reports null rather than dead when create() throws', () => {
  const throws = {
    meta: {},
    create: () => {
      throw new Error('needs a type program')
    },
  }

  assert.equal(visitorKeys(throws, ['warn'], Linter), null)
})

test('a rule with no implementation is a finding', () => {
  const finding = auditRule({
    ruleId: 'unicorn/no-such-rule',
    entry: 'warn',
    rule: undefined,
    liveSeverity: 1,
    Linter,
  })

  assert.equal(finding.kind, 'unknown')
})

test('a rule turned off downstream is a finding even though it is declared', () => {
  const finding = auditRule({
    ruleId: 'curly',
    entry: ['warn', 'multi-line'],
    rule: live,
    liveSeverity: 0,
    Linter,
  })

  assert.equal(finding.kind, 'off')
})

test('a deprecated rule is a finding and names its replacement', () => {
  const finding = auditRule({
    ruleId: 'unicorn/no-array-push-push',
    entry: 'warn',
    rule: stub,
    liveSeverity: 1,
    Linter,
  })

  assert.equal(finding.kind, 'deprecated')
  assert.match(finding.detail, /prefer-single-call/)
})

test('a rule whose create() returns an empty visitor is a finding', () => {
  const empty = { meta: { schema: [] }, create: () => ({}) }
  const finding = auditRule({
    ruleId: 'local/empty',
    entry: 'warn',
    rule: empty,
    liveSeverity: 1,
    Linter,
  })

  assert.equal(finding.kind, 'no-visitor')
})

test('a deliberately disabled rule is not a finding', () => {
  assert.equal(
    auditRule({ ruleId: 'curly', entry: 'off', rule: live, liveSeverity: 0, Linter }),
    null,
  )
})

test('a live rule that resolves to a real severity passes', () => {
  assert.equal(
    auditRule({
      ruleId: 'unicorn/prefer-single-call',
      entry: 'warn',
      rule: live,
      liveSeverity: 1,
      Linter,
    }),
    null,
  )
})
