// Guard test for `expect(...).rejects` / `.resolves` left as a bare statement.
//
// bun's `expect()` types declare every matcher as returning `void`, so
// `@typescript-eslint/no-floating-promises` sees no thenable and cannot report
// this shape under any option. `nuphos/no-unawaited-async-assertion` reports it
// in the editor, but `bun run lint` is non-blocking in CI, so this test is what
// holds the line.
//
// It scans text rather than driving the ESLint rule: loading
// @typescript-eslint/parser here resolves the parser from bun's global cache,
// where its own `typescript` dependency is not reachable, and the parse failure
// would make this guard report zero for the wrong reason.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const SRC_DIR = join(import.meta.dir, '..', '..')
const APP_DIR = join(SRC_DIR, '..')
// Excluded from the scan: the fixtures below are the very shape it flags.
const SELF = 'src/lib/test/unawaited-assertion-guard.test.ts'

function listSourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)

    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }

  return out
}

/** Blanks comments while preserving every offset, so line numbers stay true. */
function blankComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')

  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:\\])\/\/[^\n]*/g,
      (match, lead: string) => lead + blank(match.slice(lead.length)),
    )
}

/** Offset just past the `)` closing the `(` at `open`; -1 if unbalanced. */
function endOfCall(source: string, open: number): number {
  let depth = 0

  for (let i = open; i < source.length; i++) {
    const char = source[i]

    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return i + 1
    } else if (char === '"' || char === "'" || char === '`') {
      i++
      while (i < source.length && source[i] !== char) i += source[i] === '\\' ? 2 : 1
    }
  }

  return -1
}

const ASYNC_MODIFIER = /^\s*\.\s*(rejects|resolves)\b/
// An `expect(` preceded by any of these is consumed by something.
const CONSUMED = /(\b(?:await|return|yield)|[([,=&|?:])$/

/** 1-based line numbers of unawaited async assertions in `source`. */
function unawaitedAssertions(source: string): number[] {
  const code = blankComments(source)
  const lines: number[] = []

  for (const match of code.matchAll(/\bexpect\s*\(/g)) {
    const open = code.indexOf('(', match.index)
    const end = endOfCall(code, open)

    if (end < 0 || !ASYNC_MODIFIER.test(code.slice(end, end + 40))) continue
    if (CONSUMED.test(code.slice(0, match.index).trimEnd())) continue
    lines.push(code.slice(0, match.index).split('\n').length)
  }

  return lines
}

const relative = (file: string) => file.slice(APP_DIR.length + 1)
const files = listSourceFiles(SRC_DIR).filter((file) => relative(file) !== SELF)

describe('async assertions are awaited', () => {
  // Without these, a scanner that had quietly stopped matching would report
  // zero offenders and read as a clean bill of health.
  test('the scanner still flags a known violation', () => {
    expect(unawaitedAssertions('expect(p as Promise<number>).rejects.toThrow()\n')).toEqual([1])
    expect(unawaitedAssertions('for (const p of ps) expect(p).resolves.toBe(1)\n')).toEqual([1])
  })

  test('the scanner does not flag the awaited forms', () => {
    expect(unawaitedAssertions('await expect(p).rejects.toThrow()\n')).toEqual([])
    expect(unawaitedAssertions('return expect(p).resolves.toBe(1)\n')).toEqual([])
    expect(unawaitedAssertions('expect(x).toBe(1)\n')).toEqual([])
    // Prose describing the pattern is not an instance of it.
    expect(unawaitedAssertions('// never write expect(p).rejects.toThrow() bare\n')).toEqual([])
  })

  test('the scan actually covered the test suite', () => {
    expect(files.filter((file) => file.endsWith('.test.ts')).length).toBeGreaterThan(50)
  })

  test('no source file leaves an .rejects/.resolves assertion unawaited', () => {
    const offenders = files
      .flatMap((file) =>
        unawaitedAssertions(readFileSync(file, 'utf8')).map(
          (line) => `${relative(file)}:${String(line)}`,
        ),
      )
      .sort((a, b) => a.localeCompare(b))

    expect(
      offenders,
      'An `expect(...).rejects` / `.resolves` assertion settles asynchronously. Left ' +
        'as a bare statement it races the rest of the test: the lines after it run ' +
        'first, and on a runner that does not track pending assertions it never runs ' +
        `at all. Prefix each with \`await\`:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
