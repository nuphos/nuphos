import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The gallery previews draw every card from sample data: nothing they import
// may load from the API, or opening the gallery would read the team's data.
const LOADERS = new Set([
  'GithubCard',
  'TeamActivityCard',
  'HomeMetricCard',
  'DashboardPanelCard',
  'useAgentStats',
  'useRepoItems',
  'api',
])

/** The names a source file imports, and the modules it imports them from. */
function imports(file: string): { names: string[]; modules: string[] } {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const found = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)]

  return {
    names: found.flatMap((m) => (m[1] ?? '').split(',').map((n) => n.trim())),
    modules: found.map((m) => m[2] ?? ''),
  }
}

test('the card previews import nothing that loads data', () => {
  const { names, modules } = imports('./homeCardPreviews.tsx')

  assert.ok(names.includes('TeamActivityView'), 'previews are read from their source')
  assert.deepEqual(
    names.filter((n) => LOADERS.has(n)),
    [],
  )
  assert.deepEqual(
    modules.filter((m) => m.endsWith('/api')),
    [],
  )
})

test('setting up a GitHub card previews it from sample rows', () => {
  // The setup lists the team's repositories to pick from, but draws the card
  // itself from samples, so picking loads nothing.
  const { names } = imports('./homeGallerySetup.tsx')

  assert.ok(names.includes('GithubSample'))
  assert.deepEqual(
    names.filter((n) => LOADERS.has(n)),
    [],
  )
})
