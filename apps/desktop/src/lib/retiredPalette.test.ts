import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The hue-named zGray, zViolet, zBlue and zOrangered scales were replaced by semantic tokens from
// packages/design-tokens (#1632). Name colors for their purpose instead:
// surface-*, state-*, text-primary/secondary/tertiary, line-*, action-primary, status-*.
const RETIRED =
  /\bz(Gray|Violet|Blue|Orangered)\b|--color-z[A-Z]\w*-|\bz(Gray|Violet|Blue|Orangered)-/

const SRC = fileURLToPath(new URL('..', import.meta.url))
const SELF = fileURLToPath(import.meta.url)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return sourceFiles(path)

    return /\.(tsx?|css)$/.test(entry.name) && path !== SELF ? [path] : []
  })
}

test('no source uses the retired hue-named scales', () => {
  const offenders = sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        RETIRED.test(line) ? [`${relative(SRC, file)}:${index + 1}`] : [],
      ),
  )

  assert.deepEqual(offenders, [])
})
