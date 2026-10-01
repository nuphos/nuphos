// A prompt is a plain .md, so `bun --hot` never reloads one. Caching it by
// name alone meant an edited prompt kept serving the old text until the
// process restarted — or until an unrelated .ts edit happened to reset the
// module. That intermittency is what made local prompt work untrustworthy.
//
// These drive the real loadTemplate against a scratch directory: a test that
// reimplemented the rule could pass while the production cache regressed.
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, test } from 'bun:test'

import { loadTemplate, renderPromptTemplate } from './system-prompt'

const dirs: string[] = []

function scratch(): { dir: URL; write: (name: string, text: string) => void } {
  const path = mkdtempSync(join(tmpdir(), 'nuphos-prompt-'))

  dirs.push(path)

  return {
    dir: pathToFileURL(`${path}/`),
    write: (name, text) => writeFileSync(join(path, name), text),
  }
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('loadTemplate', () => {
  test('serves the edited file without a process restart', () => {
    const { dir, write } = scratch()

    write('a.md', 'first')
    expect(loadTemplate('a.md', dir)).toBe('first')

    write('a.md', 'second')
    // Same-second writes can land on an identical mtime; move it forward so
    // this asserts the rule rather than the filesystem's clock resolution.
    const path = new URL('a.md', dir)
    const future = new Date(Date.now() + 2_000)

    utimesSync(path, future, future)

    expect(loadTemplate('a.md', dir)).toBe('second')
  })

  test('an untouched file is served from cache, not re-read', () => {
    const { dir, write } = scratch()

    write('b.md', 'stable')
    expect(loadTemplate('b.md', dir)).toBe('stable')

    // Proves the cache is real: the file is gone, so a second read would throw.
    rmSync(new URL('b.md', dir))
    expect(loadTemplate('b.md', dir)).toBe('stable')
  })

  test('reports a genuinely missing file instead of hiding it', () => {
    const { dir } = scratch()

    expect(() => loadTemplate('nope.md', dir)).toThrow()
  })

  test('the shipped prompts still load', () => {
    expect(loadTemplate('atlas-agent-system.md').length).toBeGreaterThan(0)
  })
})

describe('renderPromptTemplate', () => {
  test('fills placeholders and blanks unknown ones', () => {
    expect(renderPromptTemplate('t.md', 'a {{x}} b {{y}}', { x: '1' })).toBe('a 1 b ')
  })
})
