import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'

import {
  workbookBytes,
  workbookParts,
  zipParts,
} from '../../test-fixtures/xlsx-preview/workbook.mjs'

import { unpackXlsx } from './xlsxArchive.ts'
import { isXlsxFile } from './xlsxPreview.ts'
import { parseXlsxParts, columnName } from './xlsxXml.ts'

const dom = new Window()

Object.defineProperty(globalThis, 'DOMParser', { value: dom.DOMParser, configurable: true })

test('XLSX sheets preserve coordinates, shared/rich strings, booleans and cached formulas', () => {
  const sheets = parseXlsxParts(unpackXlsx(workbookBytes()))

  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    ['Overview', 'Details', 'Empty'],
  )
  assert.deepEqual(sheets[0].rows[0], ['Item', 'Quantity', 'Saved total'])
  assert.deepEqual(sheets[0].rows[1], ['Example only', '12', '120'])
  assert.equal(sheets[0].rows[2][2], '=1+2')
  assert.deepEqual(sheets[0].rows[3], [])
  assert.equal(sheets[0].rows[4][0], 'TRUE')
  assert.equal(sheets[0].rows[4][2], '#N/A')
  assert.equal(sheets[1].rows[0][0], '<script>globalThis.xlsxExecuted=true</script>')
  assert.deepEqual(sheets[2].rows, [])
  assert.equal(columnName(26), 'AA')
})

test('ZIP extraction excludes macros/external links and rejects expansion bombs', () => {
  const parts = unpackXlsx(workbookBytes())

  assert.equal(parts['xl/vbaProject.bin'], undefined)
  assert.equal(parts['xl/externalLinks/externalLink1.xml'], undefined)
  assert.throws(() => unpackXlsx(new Uint8Array(5 * 1024 * 1024 + 1)))
  assert.throws(
    () => unpackXlsx(zipParts({ 'xl/workbook.xml': 'x'.repeat(2 * 1024 * 1024 + 1) })),
    /expansion/,
  )
  assert.throws(() => unpackXlsx(new Uint8Array([1, 2, 3])))
})

test('XML entities, external sheet relationships and unsupported dimensions are rejected', () => {
  const original = workbookParts()
  const withSheet = (xml: string) => ({ ...original, 'xl/worksheets/sheet1.xml': xml })

  assert.throws(() =>
    parseXlsxParts(
      withSheet('<!DOCTYPE x [<!ENTITY x SYSTEM "https://example.invalid">]><worksheet/>'),
    ),
  )
  assert.throws(() =>
    parseXlsxParts({
      ...original,
      'xl/_rels/workbook.xml.rels': original['xl/_rels/workbook.xml.rels'].replace(
        'Target="worksheets/sheet1.xml"',
        'TargetMode="External" Target="https://example.invalid"',
      ),
    }),
  )
  assert.throws(
    () =>
      parseXlsxParts(
        withSheet('<worksheet><row r="2001"><c r="A2001"><v>1</v></c></row></worksheet>'),
      ),
    /row limit/,
  )
  assert.throws(
    () =>
      parseXlsxParts(withSheet('<worksheet><row r="1"><c r="CW1"><v>1</v></c></row></worksheet>')),
    /column limit/,
  )
  assert.throws(
    () =>
      parseXlsxParts(
        withSheet('<worksheet><row r="1"><c r="A1" t="s"><v>999</v></c></row></worksheet>'),
      ),
    /shared string/,
  )
})

test('XLSX extension and MIME recognition exclude legacy and macro workbooks', () => {
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  assert.equal(isXlsxFile('Report.XLSX', 'application/octet-stream'), true)
  assert.equal(isXlsxFile('attachment', `${mime}; charset=binary`), true)
  for (const name of ['report.xls', 'report.xlsm', 'report.xlsb'])
    assert.equal(isXlsxFile(name, mime), false)
  for (const name of ['report.md', 'notes.txt', 'script.js', 'unknown.bin'])
    assert.equal(isXlsxFile(name, 'application/octet-stream'), false)
})
