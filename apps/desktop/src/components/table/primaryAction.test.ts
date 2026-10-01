import assert from 'node:assert/strict'
import { test } from 'node:test'

import { primaryActionColumnKey, TABLE_CELL_ACTION_CLASS } from './primaryAction.ts'

import type { Column } from './support.ts'

type Row = Record<string, string>
const column = (key: string, header = key): Column<Row> => ({
  key,
  header,
  render: (row) => row[key],
})

test('uses the human resource name rather than namespace or a machine ID', () => {
  assert.equal(
    primaryActionColumnKey([column('namespace'), column('resourceId'), column('name')]),
    'name',
  )
})
test('prefers a descriptive title over a leading issue number', () => {
  assert.equal(primaryActionColumnKey([column('number', '#'), column('title')]), 'title')
})
test('recognizes camel-case identifier columns', () => {
  assert.equal(primaryActionColumnKey([column('status'), column('serviceName')]), 'serviceName')
})
test('uses an explicit primary action before conventions', () => {
  assert.equal(
    primaryActionColumnKey([{ ...column('account'), primaryAction: true }, column('name')]),
    'account',
  )
})
test('falls back to an ID and then the first visible data column', () => {
  assert.equal(primaryActionColumnKey([column('status'), column('clusterId')]), 'clusterId')
  assert.equal(primaryActionColumnKey([column('status'), column('age')]), 'status')
})
test('never chooses the blank row-actions column', () => {
  assert.equal(primaryActionColumnKey([column('__row_actions', ''), column('name')]), 'name')
  assert.equal(primaryActionColumnKey([column('__row_actions', '')]), null)
})

test('every navigable table value has a visible violet text affordance', () => {
  assert.match(TABLE_CELL_ACTION_CLASS, /(?:^|\s)text-zViolet-accent(?:\s|$)/)
  assert.match(TABLE_CELL_ACTION_CLASS, /\[&_\*\]:!text-inherit/)
})
