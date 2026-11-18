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

  assert.deepEqual([...byTest], [
    ['A/testOne()', 'Passed'],
    ['B/testTwo()', 'Failed'],
  ])
})

test('a test failing here that passed on main, or that main lacks, is a new failure', () => {
  const main = results(run({ 'A/testOld()': 'Passed', 'A/testBroken()': 'Failed', 'A/testSkipped()': 'Skipped' }))
  const branch = results(
    run({
      'A/testOld()': 'Failed',
      'A/testBroken()': 'Failed',
      'A/testSkipped()': 'Failed',
      'A/testAdded()': 'Failed',
    }),
  )

  assert.deepEqual(compare(branch, main), {
    newFailures: ['A/testAdded()', 'A/testOld()', 'A/testSkipped()'],
    stillFailing: ['A/testBroken()'],
    fixed: [],
  })
})

test('a test failing on main and passing here is fixed, and nothing is new', () => {
  const main = results(run({ 'A/testBroken()': 'Failed', 'A/testFine()': 'Passed' }))
  const branch = results(run({ 'A/testBroken()': 'Passed', 'A/testFine()': 'Passed' }))

  assert.deepEqual(compare(branch, main), { newFailures: [], stillFailing: [], fixed: ['A/testBroken()'] })
})

test('a run that stopped partway fails on the tests it never ran', () => {
  const main = results(run({ 'A/testOne()': 'Passed', 'A/testTwo()': 'Passed', 'A/testThree()': 'Failed' }))
  const branch = results(run({ 'A/testOne()': 'Passed' }))

  assert.deepEqual(compare(branch, main).newFailures, ['A/testTwo() (did not run)'])
})

test('a renamed test, with the same count as main, is not missing', () => {
  const main = results(run({ 'A/testOld()': 'Passed' }))
  const branch = results(run({ 'A/testNew()': 'Passed' }))

  assert.deepEqual(compare(branch, main), { newFailures: [], stillFailing: [], fixed: [] })
})

test('the summary names each group and says when nothing is new', () => {
  const text = summary({ newFailures: [], stillFailing: ['A/testBroken()'], fixed: [] }, 2)

  assert.match(text, /^2 tests ran\. No new failures\./)
  assert.match(text, /Also failing on main \(1\)/)
  assert.doesNotMatch(text, /New failures/)
})
