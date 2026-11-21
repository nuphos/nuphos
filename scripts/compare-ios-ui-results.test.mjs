import assert from 'node:assert/strict'
import test from 'node:test'

import { compare, results, summary } from './compare-ios-ui-results.mjs'

const run = (cases) => ({
  testNodes: [
    {
      nodeType: 'Test Plan',
      children: [
        {
          nodeType: 'Unit test bundle',
          children: Object.entries(cases).map(([id, result]) => ({
            nodeType: 'Test Case',
            name: id.split('/')[1],
            nodeIdentifier: id,
            result,
          })),
        },
      ],
    },
  ],
})

test('results reads every test case, however deep, by identifier', () => {
  const byTest = results(run({ 'A/testOne()': 'Passed', 'B/testTwo()': 'Failed' }))

  assert.deepEqual(
    [...byTest],
    [
      ['A/testOne()', 'Passed'],
      ['B/testTwo()', 'Failed'],
    ],
  )
})

test('a test failing here that passed on main, or that the diff adds, is a new failure', () => {
  const main = results(
    run({ 'A/testOld()': 'Passed', 'A/testBroken()': 'Failed', 'A/testSkipped()': 'Skipped' }),
  )
  const branch = results(
    run({
      'A/testOld()': 'Failed',
      'A/testBroken()': 'Failed',
      'A/testSkipped()': 'Failed',
      'A/testAdded()': 'Failed',
    }),
  )

  assert.deepEqual(compare(branch, main, ['apps/ios/UITests/A.swift']), {
    newFailures: ['A/testAdded()', 'A/testOld()', 'A/testSkipped()'],
    newOnMain: [],
    notHereYet: [],
    stillFailing: ['A/testBroken()'],
    fixed: [],
  })
})

test('a failing test the baseline lacks is inherited from main unless the diff touches its file', () => {
  const main = results(run({ 'A/testOne()': 'Passed', 'B/testOne()': 'Passed' }))
  const branch = results(
    run({
      'A/testOne()': 'Passed',
      'A/testMine()': 'Failed',
      'B/testOne()': 'Passed',
      'B/testTheirs()': 'Failed',
    }),
  )

  assert.deepEqual(compare(branch, main, ['apps/ios/UITests/A.swift']), {
    newFailures: ['A/testMine()'],
    newOnMain: ['B/testTheirs()'],
    notHereYet: [],
    stillFailing: [],
    fixed: [],
  })
})

test('with no diff given, every failing test the baseline lacks is inherited', () => {
  const main = results(run({ 'A/testOne()': 'Passed' }))
  const branch = results(run({ 'A/testOne()': 'Passed', 'A/testAdded()': 'Failed' }))

  assert.deepEqual(compare(branch, main).newOnMain, ['A/testAdded()'])
})

test('a test failing on main and passing here is fixed, and nothing is new', () => {
  const main = results(run({ 'A/testBroken()': 'Failed', 'A/testFine()': 'Passed' }))
  const branch = results(run({ 'A/testBroken()': 'Passed', 'A/testFine()': 'Passed' }))

  assert.deepEqual(compare(branch, main), {
    newFailures: [],
    newOnMain: [],
    notHereYet: [],
    stillFailing: [],
    fixed: ['A/testBroken()'],
  })
})

test('a run that stopped partway fails on the tests it never ran', () => {
  const main = results(
    run({ 'A/testOne()': 'Passed', 'A/testTwo()': 'Passed', 'A/testThree()': 'Failed' }),
  )
  const branch = results(run({ 'A/testOne()': 'Passed' }))
  const tree = new Set(['testOne', 'testTwo', 'testThree'])

  assert.deepEqual(compare(branch, main, [], tree).newFailures, ['A/testTwo() (did not run)'])
})

test('a test the branch does not have yet is not charged as "did not run"', () => {
  const main = results(run({ 'A/testOne()': 'Passed', 'A/testAddedLater()': 'Passed' }))
  const branch = results(run({ 'A/testOne()': 'Passed' }))
  const tree = new Set(['testOne'])

  assert.deepEqual(compare(branch, main, [], tree), {
    newFailures: [],
    newOnMain: [],
    notHereYet: ['A/testAddedLater()'],
    stillFailing: [],
    fixed: [],
  })
})

test('with no tree given, a missing test is still charged, as it was before', () => {
  const main = results(run({ 'A/testOne()': 'Passed', 'A/testAddedLater()': 'Passed' }))
  const branch = results(run({ 'A/testOne()': 'Passed' }))

  assert.deepEqual(compare(branch, main).newFailures, ['A/testAddedLater() (did not run)'])
})

test('a renamed test, with the same count as main, is not missing', () => {
  const main = results(run({ 'A/testOld()': 'Passed' }))
  const branch = results(run({ 'A/testNew()': 'Passed' }))

  assert.deepEqual(compare(branch, main), {
    newFailures: [],
    newOnMain: [],
    notHereYet: [],
    stillFailing: [],
    fixed: [],
  })
})

test('the summary names each group and says when nothing is new', () => {
  const text = summary({ newFailures: [], stillFailing: ['A/testBroken()'], fixed: [] }, 2)

  assert.match(text, /^2 tests ran\. No new failures\./)
  assert.match(text, /Also failing on main \(1\)/)
  assert.doesNotMatch(text, /New failures/)
})

test('the summary shows inherited failures without counting them against the branch', () => {
  const text = summary(
    { newFailures: [], newOnMain: ['B/testTheirs()'], stillFailing: [], fixed: [] },
    2,
  )

  assert.match(text, /^2 tests ran\. No new failures\./)
  assert.match(text, /New on main since baseline, not blocking \(1\)/)
  assert.match(text, /B\/testTheirs\(\)/)
})
