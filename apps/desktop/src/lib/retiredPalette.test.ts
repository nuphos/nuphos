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

// Tailwind's own hue scales (`text-amber-400`, `bg-violet-500/10`) bypass the tokens the same way.
// A state is status-success/warning/danger/attention, a chart is data-1, anything else a text tone.
const UTILITIES = ['bg', 'text', 'border', 'ring', 'from', 'to', 'via', 'fill', 'stroke', 'outline']
const HUES = [
  'gray',
  'zinc',
  'neutral',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
].concat(['emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose'])
const TAILWIND_HUE = new RegExp(
  `(?<![\\w-])(${UTILITIES.join('|')})-(${HUES.join('|')})-\\d{2,3}\\b`,
)
// Categories that must stay apart at a glance, like a calendar's trigger kinds, may keep hues.
const HUE_ALLOWED = new Set(['views/triggers/calendar/model.ts'])

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

test('no source uses Tailwind hue scales outside categorical palettes', () => {
  const offenders = sourceFiles(SRC).flatMap((file) => {
    if (HUE_ALLOWED.has(relative(SRC, file))) return []

    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        TAILWIND_HUE.test(line) ? [`${relative(SRC, file)}:${index + 1}`] : [],
      )
  })

  assert.deepEqual(offenders, [])
})
