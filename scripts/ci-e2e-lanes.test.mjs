import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

function job(name) {
  const start = ci.indexOf(`\n  ${name}:\n`)
  const end = ci.slice(start + 1).search(/\n {2}[a-z0-9_-]+:\n/u)

  return ci.slice(start, start + 1 + end)
}

const group = job('e2e').match(/^ {4}concurrency:\n {6}group: (.+)$/mu)?.[1] ?? ''

// Pull requests share a bounded number of e2e machines (#4152): six lanes for each part.
test('e2e pull request runs spread over six lanes per part, by run_id modulo 6', () => {
  assert.match(job('changes'), /^ {6}e2e_lane: \$\{\{ steps\.lane\.outputs\.lane \}\}$/mu)
  assert.match(job('changes'), /echo "lane=\$\(\(GITHUB_RUN_ID % 6 \+ 1\)\)" >> "\$GITHUB_OUTPUT"/u)
  assert.match(group, /needs\.changes\.outputs\.e2e_lane/u)
  assert.doesNotMatch(group, /endsWith\(github\.run_id/u)
  assert.match(group, /\}\}-\$\{\{ matrix\.part \}\}$/u)
})

// The run on main after a merge must not wait behind, or hold up, pull requests.
test('e2e on a push to main has a group of its own', () => {
  assert.match(group, /github\.event_name == 'push' && format\('main-\{0\}', github\.run_id\)/u)
})

// The merge queue skips e2e, so a merge that lands right after must not cancel main's run.
test('a push to main does not cancel the run on main before it', () => {
  assert.match(
    ci,
    /^concurrency:\n(?: {2}.*\n)*? {2}cancel-in-progress: \$\{\{ github\.event_name != 'push' \}\}$/mu,
  )
})
