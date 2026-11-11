import assert from 'node:assert/strict'
import { test } from 'node:test'

import { navigationFromAppPath, pageLocationForNavigation } from './appRoutes.ts'
import {
  filePreviewId,
  filePreviewKind,
  filePreviewTitle,
  isFilePreviewId,
  isHtmlFileName,
  putFilePreview,
  readFilePreview,
  subscribeFilePreviews,
} from './filePreviews.ts'
import { artifactPagePath } from './sessionArtifacts.ts'

test('recognises HTML files by extension, any case', () => {
  assert.equal(isHtmlFileName('global-report-20261110.html'), true)
  assert.equal(isHtmlFileName('INDEX.HTM'), true)
  assert.equal(isHtmlFileName('page.xhtml'), true)
  assert.equal(isHtmlFileName('notes.md'), false)
  assert.equal(isHtmlFileName('html'), false)
  assert.equal(isHtmlFileName('report.html.zip'), false)
})

test('Markdown files preview as documents, other files not at all', () => {
  assert.equal(filePreviewKind('README.md'), 'markdown')
  assert.equal(filePreviewKind('notes.Markdown'), 'markdown')
  assert.equal(filePreviewKind('report.html'), 'html')
  assert.equal(filePreviewKind('data.csv'), null)
  assert.equal(isHtmlFileName('README.md'), false)
  assert.equal(filePreviewTitle('docs/README.md'), 'README')
})

test('a Markdown preview is held as a Markdown version', () => {
  const id = filePreviewId('g-md', 'f')

  putFilePreview(id, 'summary.md', '# Hi')
  assert.equal(readFilePreview(id)?.kind, 'markdown')
})

test('preview ids never look like an artifact id', () => {
  const id = filePreviewId('g1', 'f1')

  assert.equal(isFilePreviewId(id), true)
  assert.doesNotMatch(id, /^[a-z0-9][a-z0-9-]{0,63}$/)
  assert.equal(isFilePreviewId('q3-report'), false)
})

test('titles drop the folder and the extension', () => {
  assert.equal(filePreviewTitle('out/global-report-20261110.html'), 'global-report-20261110')
  assert.equal(filePreviewTitle('.html'), '.html')
})

test('a preview is held as one HTML version and refreshed on reopen', () => {
  const id = filePreviewId('g-refresh', 'f')
  let calls = 0
  const stop = subscribeFilePreviews(() => calls++)

  putFilePreview(id, 'report.html', '<p>one</p>')
  putFilePreview(id, 'report.html', '<p>two</p>')
  stop()
  putFilePreview(id, 'report.html', '<p>three</p>')

  const held = readFilePreview(id)

  assert.equal(calls, 2)
  assert.equal(held?.kind, 'html')
  assert.equal(held?.title, 'report')
  assert.equal(held?.version, 1)
  assert.equal(held?.content, '<p>three</p>')
})

test('only the most recent previews stay in memory', () => {
  const ids = Array.from({ length: 20 }, (_, i) => filePreviewId('g-limit', String(i)))

  for (const id of ids) putFilePreview(id, 'a.html', id)
  assert.equal(readFilePreview(ids[0]), undefined)
  assert.equal(readFilePreview(ids[19])?.content, ids[19])
})

test('a preview opens and reopens as the same artifact tab', () => {
  const id = filePreviewId('6f1c-group', '9a2e-file')
  const navigation = navigationFromAppPath(artifactPagePath('team-1', id))

  assert.equal(navigation?.active, 'team.artifact')
  assert.equal(navigation?.filter, id)
  assert.equal(navigationFromAppPath(pageLocationForNavigation(navigation!).href)?.filter, id)
})
