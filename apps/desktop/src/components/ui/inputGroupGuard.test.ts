import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

// Text-entry controls get no global focus ring (index.css), so each one must
// show focus itself: a bordered field through its own focus: classes, and a
// chrome-less one inside a decorated wrapper through InputGroup's ring.

const SRC = join(import.meta.dirname, '../..')

const NON_TEXT_TYPE = /\btype="(checkbox|radio|range|color|file|hidden)"/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.test.tsx')) return []

    return [path]
  })
}

function openingTag(src: string, start: number): string {
  let depth = 0
  let quote: string | null = null

  for (let i = start; i < src.length; i++) {
    const char = src[i]

    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return src.slice(start, i + 1)
  }

  return src.slice(start)
}

function textControls(src: string): { line: number; tag: string }[] {
  return [...src.matchAll(/<(input|textarea)\b/g)].flatMap((match) => {
    const tag = openingTag(src, match.index)

    if (NON_TEXT_TYPE.test(tag)) return []

    return [{ line: src.slice(0, match.index).split('\n').length, tag }]
  })
}

function chromelessControls(src: string): number[] {
  return textControls(src)
    .filter(({ tag }) => /\bbg-transparent\b/.test(tag) && !/\bborder\b/.test(tag))
    .map(({ line }) => line)
}

// Only literal class strings are checked; a shared class constant is reviewed
// where it is defined.
function unfocusedControls(src: string): number[] {
  return textControls(src)
    .filter(({ tag }) => tag.includes('className="') && !/\bfocus(-visible|-within)?:/.test(tag))
    .map(({ line }) => line)
}

function offenders(check: (src: string) => number[]): string[] {
  return sourceFiles(SRC).flatMap((file) =>
    check(readFileSync(file, 'utf8')).map((line) => `${relative(SRC, file)}:${String(line)}`),
  )
}

test('chrome-less inputs inside a decorated wrapper use InputGroupInput', () => {
  assert.deepEqual(
    offenders(chromelessControls),
    [],
    'Wrap these in InputGroup and render InputGroupInput',
  )
})

test('standalone text inputs style their own focus state', () => {
  assert.deepEqual(offenders(unfocusedControls), [], 'Add a focus: border or ring')
})

test('the guards flag the right shapes', () => {
  assert.deepEqual(
    chromelessControls('<div>\n<input value={q} className="flex-1 bg-transparent outline-none" />'),
    [2],
  )
  assert.deepEqual(chromelessControls('<input className="border bg-transparent" />'), [])
  assert.deepEqual(chromelessControls('<InputGroupInput className="bg-transparent" />'), [])
  assert.deepEqual(unfocusedControls('<input className="border" />'), [1])
  assert.deepEqual(unfocusedControls('<input className="border focus:border-zViolet-500" />'), [])
  assert.deepEqual(unfocusedControls('<input type="checkbox" className="h-4" />'), [])
})
