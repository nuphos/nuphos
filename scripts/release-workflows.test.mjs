import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')

const releases = {
  'release-backend.yml': 'backend-v',
  'release-desktop.yml': 'v',
  'release-cli.yml': 'cli-v',
  'release-ios.yml': 'ios-v',
}

function jobs(workflow) {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'))
  const parts = body.split(/^ {2}([a-z0-9_-]+):\n/mu).slice(1)
  const result = {}

  for (let i = 0; i < parts.length; i += 2) result[parts[i]] = parts[i + 1]

  return result
}

function needs(job) {
  const match = job.match(/^ {4}needs: (.+)$/mu)

  if (!match) return []

  return match[1]
    .replace(/[[\]]/gu, '')
    .split(',')
    .map((name) => name.trim())
}

for (const [name, prefix] of Object.entries(releases)) {
  test(`${name} cannot publish without the provenance gate`, () => {
    const workflow = read(name)
    const on = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\nconcurrency:'))

    // Only a dispatch, so main's reviewed copy of this file is what runs. A
    // tag push would load the file from the tagged commit, which can drop the gate.
    assert.deepEqual(on.match(/^ {2}[a-z_]+:/gmu), ['  workflow_dispatch:'])
    assert.doesNotMatch(workflow, /github\.ref_name|github\.sha/u)

    const all = jobs(workflow)

    assert.match(all.provenance, /^ {4}uses: \.\/\.github\/workflows\/release-provenance\.yml$/mu)
    assert.match(all.provenance, /^ {6}tag: \$\{\{ inputs\.tag \}\}$/mu)
    assert.match(all.provenance, new RegExp(`^ {6}prefix: ${prefix}$`, 'mu'))

    const gated = new Set(['provenance'])

    for (const [job, text] of Object.entries(all)) {
      if (job === 'provenance') continue
      const deps = needs(text)

      assert.ok(
        deps.some((dep) => gated.has(dep)),
        `${job} must need provenance or a job that does`,
      )
      gated.add(job)
      const checkouts = text.match(/uses: actions\/checkout@/gu) ?? []
      const pinned = text.match(/^ {10}ref: \$\{\{ needs\.provenance\.outputs\.sha \}\}$/gmu) ?? []

      assert.equal(pinned.length, checkouts.length, `${job} must check out the verified commit`)
      if (checkouts.length > 0)
        assert.ok(deps.includes('provenance'), `${job} reads the verified commit`)
    }
  })
}

test('the gate runs only from main and returns the commit it verified', () => {
  const gate = read('release-provenance.yml')

  assert.match(
    gate,
    /^ {4}if: github\.repository == 'nuphos\/nuphos' && github\.ref == 'refs\/heads\/main'$/mu,
  )
  assert.match(gate, /^ {10}ref: main$/mu)
  assert.match(gate, /bash scripts\/verify-release-provenance\.sh "\$SHA"\n {10}echo "sha=\$SHA"/u)
  assert.match(gate, /value: \$\{\{ jobs\.verify\.outputs\.sha \}\}/u)
})
