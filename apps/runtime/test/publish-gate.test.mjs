import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`
  const start = workflow.indexOf(marker)

  assert.notEqual(start, -1, `Missing workflow step: ${name}`)
  const next = workflow.indexOf('\n      - name:', start + marker.length)

  return workflow.slice(start, next === -1 ? workflow.length : next)
}

const build = readFileSync(
  new URL('../../../.github/workflows/runtime-build.yml', import.meta.url),
  'utf8',
)

test('publishes images only from commits already on main', () => {
  const plan = workflowStep(build, 'Resolve and vet the commit to publish')

  // A tag push would load this workflow from the tagged commit, leaving the
  // gate below under the control of the commit it is meant to distrust.
  assert.doesNotMatch(build, /^on:\n(?: .*\n)* {2}push:/mu)
  assert.match(
    build,
    /^ {2}plan:\n {4}if: github\.ref == 'refs\/heads\/main' && vars\.RUNTIME_PUBLISH_ENABLED == 'true'$/mu,
  )
  assert.match(plan, /git merge-base --is-ancestor "\$BUILD_SHA" origin\/main/)
  assert.match(
    plan,
    /"\$RELEASE_TAG" != "runtime-v\$\{VERSION\}"/,
    'a release tag must match the version packaged at the commit it names',
  )
  // The job that can push packages must not be able to start without that proof.
  assert.match(build, /^ {2}build:\n {4}needs: plan$/mu)
  assert.match(build, /ref: \$\{\{ needs\.plan\.outputs\.build_sha \}\}/)
  assert.doesNotMatch(
    build.slice(0, build.indexOf('  build:')),
    /packages: write/,
    'the job that vets the commit must not itself be able to push packages',
  )
})

test('the release path tags main and publishes that tag', () => {
  const release = readFileSync(
    new URL('../../../.github/workflows/runtime-release.yml', import.meta.url),
    'utf8',
  )

  assert.match(
    release,
    /^ {2}tag:\n {4}if: github\.ref == 'refs\/heads\/main' && vars\.RUNTIME_PUBLISH_ENABLED == 'true'$/mu,
  )
  // A dispatch made with GITHUB_TOKEN would not start a run, so the release
  // must call the build rather than trigger it.
  assert.match(release, /^ {4}uses: \.\/\.github\/workflows\/runtime-build\.yml$/mu)
  assert.match(release, /release_tag: runtime-v\$\{\{ needs\.tag\.outputs\.version \}\}/)
  assert.doesNotMatch(release, /gh workflow run/)
})

test('GitHub release publication waits for all images and requires an existing tag', () => {
  assert.match(build, /needs: \[plan, build\]/)
  assert.match(build, /if: inputs\.release_tag != ''/)
  assert.match(build, /gh release create .*--verify-tag --latest=false/)
  assert.match(build, /gh release view "\$RELEASE_TAG"/)
  for (const name of ['release', 'update-claude-sdk', 'update-codex-cli']) {
    const caller = readFileSync(
      new URL(`../../../.github/workflows/runtime-${name}.yml`, import.meta.url),
      'utf8',
    )
    assert.match(caller, /contents: write\n      packages: write/)
  }
})
