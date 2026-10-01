import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { buildReleasePlan } from './daily-release-plan.mjs'
import { parseCronValues, scheduledReleaseDay } from './release-schedule.mjs'

const temporaryRepositories = new Set()

after(() => {
  for (const root of temporaryRepositories) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function writePackage(root, component, version) {
  const directory = join(root, 'apps', component)

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: component, version }, null, 2)}\n`,
  )
}

function commit(root, message) {
  git(root, 'add', '.')
  git(root, 'commit', '-m', message)

  return git(root, 'rev-parse', 'HEAD')
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'daily-release-plan-'))

  temporaryRepositories.add(root)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.name', 'Release Test')
  git(root, 'config', 'user.email', 'release-test@example.com')

  writePackage(root, 'backend', '1.2.3')
  writePackage(root, 'desktop', '4.5.6')
  writePackage(root, 'ios', '0.1.0')
  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 1\n')
  writeFileSync(join(root, 'apps/desktop/index.ts'), 'export const desktop = 1\n')
  writeFileSync(join(root, 'apps/ios/App.swift'), 'let ios = 1\n')
  commit(root, 'initial release')
  git(root, 'tag', 'backend-v1.2.3')
  git(root, 'tag', 'v4.5.6')
  git(root, 'tag', 'ios-v0.1.0')

  return root
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`
  const start = workflow.indexOf(marker)

  assert.notEqual(start, -1, `Missing workflow step: ${name}`)
  const next = workflow.indexOf('\n      - name:', start + marker.length)

  return workflow.slice(start, next === -1 ? workflow.length : next)
}

test('returns no-op when every component matches its release tag', () => {
  const root = createRepository()
  const plan = buildReleasePlan(root)

  assert.equal(plan.noUnreleasedChanges, true)
  assert.equal(plan.releasePrNeeded, false)
  assert.equal(plan.components.backend.action, 'none')
  assert.equal(plan.components.desktop.action, 'none')
  assert.equal(plan.components.ios.action, 'none')
})

test('plans iOS on its own ios-v track', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/ios/App.swift'), 'let ios = 2\n')
  commit(root, 'feat(ios): add pinned chats')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'none')
  assert.equal(plan.components.desktop.action, 'none')
  assert.equal(plan.components.ios.action, 'bump')
  assert.equal(plan.components.ios.releaseType, 'minor')
  assert.equal(plan.components.ios.nextVersion, '0.2.0')
  assert.equal(plan.components.ios.latestTag, 'ios-v0.1.0')
})

test('bumps only the component with unreleased source changes', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/desktop/index.ts'), 'export const desktop = 2\n')
  commit(root, 'change desktop')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'none')
  assert.equal(plan.components.desktop.action, 'bump')
  assert.equal(plan.components.desktop.nextVersion, '4.5.7')
  assert.equal(plan.releasePrNeeded, true)
})

test('does not plan a new version during reconcile-only runs', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'feat(backend): add a capability')

  const plan = buildReleasePlan(root, { reconcileOnly: true })

  assert.equal(plan.components.backend.action, 'none')
  assert.equal(plan.components.backend.nextVersion, '1.2.3')
  assert.equal(plan.releasePrNeeded, false)
})

test('releases an already bumped version during reconcile-only runs', () => {
  const root = createRepository()

  writePackage(root, 'backend', '1.2.4')
  const versionCommit = commit(root, 'release: backend v1.2.4')

  const plan = buildReleasePlan(root, { reconcileOnly: true })

  assert.equal(plan.components.backend.action, 'release-current')
  assert.equal(plan.components.backend.releaseCommit, versionCommit)
  assert.equal(plan.releasePrNeeded, false)
})

test('defers later changes after a component already released that day', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'fix(backend): correct an issue after release')

  const plan = buildReleasePlan(root, { releaseDay: todayInShanghai() })

  assert.equal(plan.components.backend.action, 'none')
  assert.equal(plan.components.backend.nextVersion, '1.2.3')
  assert.equal(plan.releasePrNeeded, false)
  assert.equal(plan.releaseDeferred, true)
})

test('releases again on a manual run after the schedule already released today', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'fix(backend): correct an issue after release')

  // A manual run carries no release day, so the once-a-day cap never applies.
  const plan = buildReleasePlan(root, { releaseDay: null })

  assert.equal(plan.components.backend.action, 'bump')
  assert.equal(plan.components.backend.nextVersion, '1.2.4')
  assert.equal(plan.releasePrNeeded, true)
  assert.equal(plan.releaseDeferred, false)
})

test('plans no release on a manual run with nothing unreleased', () => {
  const root = createRepository()

  const plan = buildReleasePlan(root, { releaseDay: null })

  assert.equal(plan.components.backend.action, 'none')
  assert.equal(plan.components.desktop.action, 'none')
  assert.equal(plan.releasePrNeeded, false)
  assert.equal(plan.noUnreleasedChanges, true)
})

test('plans changes when the latest release belongs to an earlier release day', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'fix(backend): correct an issue after release')

  const plan = buildReleasePlan(root, { releaseDay: '2099-01-01' })

  assert.equal(plan.components.backend.action, 'bump')
  assert.equal(plan.components.backend.nextVersion, '1.2.4')
  assert.equal(plan.releaseDeferred, false)
})

test('increments patch versions numerically without promoting the minor version', () => {
  const root = createRepository()

  git(root, 'tag', '-d', 'backend-v1.2.3')
  writePackage(root, 'backend', '0.19.99')
  commit(root, 'set backend release baseline')
  git(root, 'tag', 'backend-v0.19.99')
  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'change backend')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'bump')
  assert.equal(plan.components.backend.nextVersion, '0.19.100')
})

test('plans Backend and Desktop versions independently', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  writeFileSync(join(root, 'apps/desktop/index.ts'), 'export const desktop = 2\n')
  commit(root, 'change both components')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.nextVersion, '1.2.4')
  assert.equal(plan.components.desktop.nextVersion, '4.5.7')
})

test('uses Conventional Commit feat messages for minor releases', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'feat(backend): add a capability')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.releaseType, 'minor')
  assert.equal(plan.components.backend.nextVersion, '1.3.0')
  assert.equal(plan.components.desktop.action, 'none')
})

test('caps breaking feat headers at minor releases', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/desktop/index.ts'), 'export const desktop = 2\n')
  commit(root, 'feat(desktop)!: replace the public API')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.desktop.releaseType, 'minor')
  assert.equal(plan.components.desktop.nextVersion, '4.6.0')
})

test('takes the highest Conventional Commit bump for each component', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'feat(backend): add a capability')
  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 3\n')
  commit(root, 'fix(backend): change a contract\n\nBREAKING CHANGE: callers must send a new field')
  writeFileSync(join(root, 'apps/desktop/index.ts'), 'export const desktop = 2\n')
  commit(root, 'fix(desktop): correct a rendering bug')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.releaseType, 'minor')
  assert.equal(plan.components.backend.nextVersion, '1.3.0')
  assert.equal(plan.components.desktop.releaseType, 'patch')
  assert.equal(plan.components.desktop.nextVersion, '4.5.7')
})

test('caps breaking non-feat commits at patch releases', () => {
  const root = createRepository()

  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'fix(backend)!: change a contract\n\nBREAKING CHANGE: callers must send a new field')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.releaseType, 'patch')
  assert.equal(plan.components.backend.nextVersion, '1.2.4')
})

test('continues automatic patch releases from a manually tagged major baseline', () => {
  const root = createRepository()

  writePackage(root, 'backend', '2.0.0')
  commit(root, 'release: backend v2.0.0')
  git(root, 'tag', 'backend-v2.0.0')
  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'fix(backend): correct request validation')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.releaseType, 'patch')
  assert.equal(plan.components.backend.nextVersion, '2.0.1')
})

test('continues automatic minor releases from a manually tagged major baseline', () => {
  const root = createRepository()

  writePackage(root, 'desktop', '5.0.0')
  commit(root, 'release: desktop v5.0.0')
  git(root, 'tag', 'v5.0.0')
  writeFileSync(join(root, 'apps/desktop/index.ts'), 'export const desktop = 2\n')
  commit(root, 'feat(desktop): add release history')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.desktop.releaseType, 'minor')
  assert.equal(plan.components.desktop.nextVersion, '5.1.0')
})

test('rejects manual major versions that do not reset minor and patch', () => {
  const root = createRepository()

  writePackage(root, 'backend', '2.1.0')
  commit(root, 'release: backend v2.1.0')

  assert.throws(
    () => buildReleasePlan(root),
    /backend manual major version 2\.1\.0 must use the form 2\.0\.0/,
  )
})

test('rejects a package version that is behind its latest release tag', () => {
  const root = createRepository()

  writePackage(root, 'backend', '1.2.2')
  commit(root, 'regress backend version')

  assert.throws(
    () => buildReleasePlan(root),
    /backend package version 1\.2\.2 is behind release tag backend-v1\.2\.3/,
  )
})

test('releases an already bumped version instead of bumping it again', () => {
  const root = createRepository()

  writePackage(root, 'backend', '1.2.4')
  const versionCommit = commit(root, 'bump backend')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'release-current')
  assert.equal(plan.components.backend.nextVersion, '1.2.4')
  assert.equal(plan.components.backend.releaseCommit, versionCommit)
  assert.equal(plan.releasePrNeeded, false)
})

test('targets the version introduction commit when package metadata changes later', () => {
  const root = createRepository()

  writePackage(root, 'backend', '1.2.4')
  const versionCommit = commit(root, 'bump backend')

  writeFileSync(
    join(root, 'apps/backend/package.json'),
    `${JSON.stringify(
      { name: 'backend', version: '1.2.4', description: 'metadata change' },
      null,
      2,
    )}\n`,
  )
  commit(root, 'change backend metadata')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'release-current')
  assert.equal(plan.components.backend.releaseCommit, versionCommit)
})

test('after a pending version is tagged, later source changes require a new bump', () => {
  const root = createRepository()

  writePackage(root, 'backend', '1.2.4')
  commit(root, 'bump backend')
  git(root, 'tag', 'backend-v1.2.4')
  writeFileSync(join(root, 'apps/backend/index.ts'), 'export const backend = 2\n')
  commit(root, 'change backend again')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'bump')
  assert.equal(plan.components.backend.nextVersion, '1.2.5')
})

test('treats current versions as pending releases when no tags exist', () => {
  const root = createRepository()

  git(root, 'tag', '-d', 'backend-v1.2.3', 'v4.5.6', 'ios-v0.1.0')

  const plan = buildReleasePlan(root)

  assert.equal(plan.components.backend.action, 'release-current')
  assert.equal(plan.components.desktop.action, 'release-current')
  assert.equal(plan.components.ios.action, 'release-current')
  assert.equal(plan.releasePrNeeded, false)
})

test('keeps automatic version bumps behind a protected release PR', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/daily-release.yml', import.meta.url),
    'utf8',
  )

  assert.match(workflow, /Create release GitHub App token/)
  assert.match(workflow, /Validate release GitHub App credentials/)
  assert.match(workflow, /ARGS\+=\(--reconcile-only\)/)
  const buildPlan = workflowStep(workflow, 'Build release plan')

  assert.match(
    buildPlan,
    /--schedule=\$SCHEDULE/,
    'scheduled runs must date themselves by the cron that fired them',
  )
  assert.doesNotMatch(
    buildPlan,
    /--release-day=/,
    'a manual run must plan without a release day so it can release again today',
  )
  assert.match(workflow, /RELEASE_AUTOMATION_CLIENT_ID/)
  assert.match(workflow, /RELEASE_AUTOMATION_APP_ID/)
  assert.match(workflow, /gh pr create/)
  assert.match(workflow, /gh pr merge/)
  assert.match(workflow, /gh pr checks/)
  const createAppToken = workflowStep(workflow, 'Create release GitHub App token')

  assert.match(
    createAppToken,
    /permission-checks: read/,
    'the release app token must be able to read checks',
  )
  assert.match(
    createAppToken,
    /permission-statuses: read/,
    'the release app token must be able to read commit statuses',
  )
  assert.match(workflow, /validate-daily-release-pr\.mjs/)
  assert.match(workflow, /--admin --squash/)
  assert.doesNotMatch(workflow, /Request CodeRabbit review/)
  assert.doesNotMatch(workflow, /@coderabbitai review/)
  assert.doesNotMatch(workflow, /^[ \t]+issues: write$/m)
  for (const stepName of [
    'Configure release GitHub App credentials',
    'Reconcile a pending Backend release tag',
    'Reconcile the current Backend deployment',
    'Reconcile a pending Desktop release',
    'Create the daily release PR',
    'Keep the release PR moving',
  ]) {
    const step = workflowStep(workflow, stepName)

    assert.match(
      step,
      /GH_TOKEN: \$\{\{ steps\.release_app_token\.outputs\.token \}\}/,
      `${stepName} must use the release GitHub App token`,
    )
    assert.doesNotMatch(
      step,
      /GH_TOKEN: \$\{\{ github\.token \}\}/,
      `${stepName} must not use the workflow token`,
    )
  }
  assert.match(workflow, /git fetch origin main:refs\/remotes\/origin\/main/)
  assert.match(workflow, /main advanced after planning/)
  assert.doesNotMatch(workflow, /git push origin "HEAD:refs\/heads\/main"/)
  assert.match(workflow, /--json author,baseRefName,files,headRefName,headRefOid,state,title/)
  const keepReleasePrMoving = workflowStep(workflow, 'Keep the release PR moving')

  for (const expectedPlanInput of [
    'BACKEND_ACTION',
    'BACKEND_CURRENT_VERSION',
    'BACKEND_NEXT_VERSION',
    'BACKEND_RELEASE_TYPE',
    'DESKTOP_ACTION',
    'DESKTOP_CURRENT_VERSION',
    'DESKTOP_NEXT_VERSION',
    'DESKTOP_RELEASE_TYPE',
  ]) {
    assert.match(
      keepReleasePrMoving,
      new RegExp(`${expectedPlanInput}:`),
      `${expectedPlanInput} must be passed to the release PR validator`,
    )
  }
  assert.match(
    keepReleasePrMoving,
    /--json name 2>&1/,
    'the checks poll must capture gh pr checks stderr for inspection',
  )
  assert.match(
    keepReleasePrMoving,
    /::error::Could not read release PR checks[^\n]*\n\s+exit 1/,
    'a checks read failure must fail the run instead of exiting cleanly',
  )
  assert.doesNotMatch(
    keepReleasePrMoving,
    /2>\/dev\/null/,
    'the checks poll must not discard gh pr checks errors',
  )
})

test('reconciles a missing or failed Backend deployment', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/daily-release.yml', import.meta.url),
    'utf8',
  )

  assert.match(workflow, /Inspect the current Backend deployment/)
  assert.match(workflow, /Reconcile the current Backend deployment/)
  assert.match(workflow, /gh run rerun/)
  assert.match(workflow, /gh workflow run deploy-backend\.yml/)
  assert.match(workflow, /steps\.backend_deploy\.outputs\.state == 'failed'/)
  assert.match(workflow, /steps\.backend_deploy\.outputs\.state == 'missing'/)
})

test('a scheduled run is dated by its cron, not by when it finally ran', () => {
  const timeZone = 'Asia/Shanghai'

  // Wall-clock dating hands a catch-up that crossed midnight the new day's
  // release slot, which suppresses that day's scheduled run and leaves releases
  // drifting a day at a time.
  assert.equal(
    scheduledReleaseDay('40 23 * * *', new Date('2026-07-29T16:02:00Z'), timeZone),
    '2026-07-29',
    'a catch-up that crossed midnight still belongs to the day it was scheduled for',
  )
  assert.equal(
    scheduledReleaseDay('40 23 * * *', new Date('2026-07-29T15:45:00Z'), timeZone),
    '2026-07-29',
    'the same catch-up running on time is unchanged',
  )
  assert.equal(
    scheduledReleaseDay('40 15 * * *', new Date('2026-07-30T08:57:00Z'), timeZone),
    '2026-07-30',
    'an ordinary delay inside the same day keeps that day',
  )
  assert.equal(
    scheduledReleaseDay('40 17,19,21 * * *', new Date('2026-07-30T14:10:00Z'), timeZone),
    '2026-07-30',
    'a multi-hour cron resolves against whichever slot has already passed',
  )
  assert.equal(
    scheduledReleaseDay('40 17,19,21 * * *', new Date('2026-07-30T16:40:00Z'), timeZone),
    '2026-07-30',
    'the last slot of a multi-hour cron running late stays on its own day',
  )
})

test('keeps every scheduled slot off the hour and half hour', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/daily-release.yml', import.meta.url),
    'utf8',
  )
  // Quoting a cron is a style choice YAML leaves open, so an unquoted or
  // double-quoted schedule must reach these assertions rather than slip past
  // the pattern that collects them.
  const crons = [...workflow.matchAll(/^[ \t]*-[ \t]*cron:[ \t]*(\S.*)$/gm)].map((match) =>
    match[1].trim().replace(/^(['"])(.*)\1$/, '$2'),
  )

  assert.ok(crons.length > 0, 'the workflow must still declare a schedule')
  for (const cron of crons) {
    // The planner's own parser: a step or range expression in the minute or
    // hour field parses to null and silently falls back to wall-clock dating.
    // The other three fields never reach it, so only their presence is checked.
    const fields = cron.trim().split(/\s+/)
    const minutes = parseCronValues(fields[0], 59)
    const hours = parseCronValues(fields[1], 23)

    assert.ok(
      fields.length === 5 && minutes && hours,
      `${cron} is not a five-field schedule the planner can date; use plain comma-separated minutes and hours`,
    )
    for (const minute of minutes) {
      // :00 is documented by GitHub as a high-load period where scheduled runs
      // are delayed or dropped; :30 is not documented but is the next most
      // popular slot, so it is avoided on the same reasoning.
      assert.ok(
        minute !== 0 && minute !== 30,
        `${cron} fires at :${String(minute).padStart(2, '0')}, a congested slot; pick a minute away from :00 and :30`,
      )
    }
  }
})

test('an unusable schedule falls back to the current day rather than throwing', () => {
  const timeZone = 'Asia/Shanghai'
  const now = new Date('2026-07-30T08:00:00Z')

  for (const cron of [
    'not a cron',
    '*/5 * * * *',
    '0-30 16 * * *',
    // Hour 24 parses as an integer but lands at minute 1440, which no clock
    // reading reaches — without a range check every run would look like it had
    // crossed midnight and be dated to yesterday instead of taking this fallback.
    '0 24 * * *',
    '60 23 * * *',
    '0 16,24 * * *',
  ]) {
    assert.equal(
      scheduledReleaseDay(cron, now, timeZone),
      '2026-07-30',
      `${cron} must fall back to the current day`,
    )
  }
})
