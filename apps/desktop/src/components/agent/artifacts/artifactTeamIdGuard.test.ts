import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

// A markdown artifact shows files through `_reply-images` links, which
// ReplyImage resolves with the viewer's team. A MessageResponse drawing an
// artifact document without `teamId` turns every one into "Image unavailable".

const SRC = join(import.meta.dirname, '../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return sourceFiles(path)

    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

test('every artifact document MessageResponse passes teamId', () => {
  const missing: string[] = []
  let found = 0

  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8')

    for (const match of src.matchAll(/<MessageResponse\b[^>]*?>/gs)) {
      if (!match[0].includes('ARTIFACT_DOCUMENT_TYPE')) continue
      found++
      if (!/\bteamId=\{/.test(match[0])) missing.push(relative(SRC, file))
    }
  }

  assert.ok(found >= 2, 'expected the artifact panel and card to render documents')
  assert.deepEqual(missing, [])
})
