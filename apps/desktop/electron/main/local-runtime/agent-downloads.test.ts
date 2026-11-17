import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  MAX_DOWNLOAD_BYTES,
  saveAgentDownload,
  saveDownload,
  saveDownloadsOf,
  savePath,
  withDownloadNews,
} from './agent-downloads.ts'

/** A download as Electron hands it over, driven by the test. */
function download(filename: string, total = 7) {
  const item = Object.assign(new EventEmitter(), {
    savePath: '',
    received: 0,
    cancelled: false,
    getFilename: () => filename,
    getTotalBytes: () => total,
    getReceivedBytes: () => item.received,
    setSavePath: (file: string) => {
      item.savePath = file
    },
    cancel: () => {
      item.cancelled = true
      item.emit('done', {}, 'cancelled')
    },
  })

  return item
}

const dir = () => mkdtempSync(join(tmpdir(), 'agent-downloads-'))

test('a download is saved in the folder under its own name, without a dialog', () => {
  const folder = dir()
  const lines: string[] = []
  const item = download('report.pdf')

  saveDownload(item, folder, (line) => lines.push(line))
  assert.equal(item.savePath, join(folder, 'report.pdf'))
  item.received = 7
  item.emit('done', {}, 'completed')
  assert.deepEqual(lines, [`Downloaded: ${join(folder, 'report.pdf')} (completed, 7 bytes)`])
})

test('a name never leaves the folder or carries control characters', () => {
  const folder = join('/Users', 'me', 'Downloads', 'Nuphos')
  const free = () => false

  assert.equal(
    savePath(folder, '../../.ssh/authorized_keys', free),
    join(folder, 'authorized_keys'),
  )
  assert.equal(savePath(folder, '..\\..\\evil.exe', free), join(folder, 'evil.exe'))
  assert.equal(savePath(folder, 'a\u0000b\nc.txt', free), join(folder, 'abc.txt'))
  assert.equal(savePath(folder, '..', free), join(folder, 'download'))
  assert.equal(savePath(folder, '', free), join(folder, 'download'))
})

test('a clash is numbered instead of replacing the file there', () => {
  const folder = dir()

  writeFileSync(join(folder, 'song.mp3'), 'kept')
  const first = download('song.mp3')
  const second = download('song.mp3')

  saveDownload(first, folder, () => {})
  // The first is still downloading, so its name is taken too.
  saveDownload(second, folder, () => {})
  assert.equal(first.savePath, join(folder, 'song (1).mp3'))
  assert.equal(second.savePath, join(folder, 'song (2).mp3'))
})

test('a download over 2 GB is cancelled and reported', () => {
  const lines: string[] = []
  const known = download('big.iso', MAX_DOWNLOAD_BYTES + 1)

  saveDownload(known, dir(), (line) => lines.push(line))
  assert.equal(known.cancelled, true)

  const unknown = download('stream.bin', 0)

  saveDownload(unknown, dir(), (line) => lines.push(line))
  unknown.received = MAX_DOWNLOAD_BYTES
  unknown.emit('updated', {}, 'progressing')
  assert.equal(unknown.cancelled, false)
  unknown.received = MAX_DOWNLOAD_BYTES + 1
  unknown.emit('updated', {}, 'progressing')
  assert.equal(unknown.cancelled, true)
  assert.equal(lines.length, 2)
  for (const line of lines) assert.match(line, /^Download cancelled: .+ is larger than 2 GB\.$/)
})

test('an interrupted download says so', () => {
  const lines: string[] = []
  const item = download('notes.txt')

  saveDownload(item, dir(), (line) => lines.push(line))
  item.received = 3
  item.emit('done', {}, 'interrupted')
  assert.match(lines[0] ?? '', /^Download interrupted: .+notes\.txt \(3 bytes\)$/)
})

test("only an agent tab's downloads are saved, and its conversation is told once", () => {
  const folder = dir()
  const agentTab = {}
  const item = download('a.txt')
  const taken = item as unknown as Parameters<typeof saveAgentDownload>[0]

  saveDownloadsOf(agentTab, 'c1', () => folder)
  assert.equal(saveAgentDownload(taken, {}), false)
  assert.equal(saveAgentDownload(taken, undefined), false)
  assert.equal(saveAgentDownload(taken, agentTab), true)
  assert.equal(item.savePath, join(folder, 'a.txt'))
  item.received = 7
  item.emit('done', {}, 'completed')
  const told = (conversation: string) =>
    withDownloadNews(conversation, { content: [{ type: 'text', text: 'tabs' }] }).content

  assert.equal(told('c2').length, 1)
  assert.deepEqual(told('c1'), [
    { type: 'text', text: 'tabs' },
    { type: 'text', text: `Downloaded: ${join(folder, 'a.txt')} (completed, 7 bytes)` },
  ])
  assert.equal(told('c1').length, 1)
})
