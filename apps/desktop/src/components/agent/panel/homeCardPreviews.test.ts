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
  'useGithubRepos',
  'api',
])

test('the card previews import nothing that loads data', () => {
  const source = readFileSync(new URL('./homeCardPreviews.tsx', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)]
  const names = imports.flatMap((m) => (m[1] ?? '').split(',').map((n) => n.trim()))
  const modules = imports.map((m) => m[2] ?? '')

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
