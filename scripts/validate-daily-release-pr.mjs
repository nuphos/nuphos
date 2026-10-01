import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { isAncestor, packageContentsAt, releaseCommitParent } from './release-pr-git-facts.mjs'

const ALLOWED_AUTHORS = new Set(['app/nuphos-release-automation', 'nuphos-release-automation[bot]'])
const COMPONENTS = {
  backend: {
    packageFile: 'apps/backend/package.json',
  },
  desktop: {
    packageFile: 'apps/desktop/package.json',
  },
  ios: {
    packageFile: 'apps/ios/package.json',
  },
}
const ALLOWED_FILES = new Set(Object.values(COMPONENTS).map((config) => config.packageFile))

function parseVersion(value, label, errors) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '')

  if (!match) {
    errors.push(`${label} is not a stable semantic version: ${JSON.stringify(value)}`)

    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: value,
  }
}

function parsePackageJson(value, label, errors) {
  if (value === undefined) {
    errors.push(`${label} is missing`)

    return null
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${label} is not a JSON object`)

      return null
    }

    return parsed
  } catch (error) {
    errors.push(`${label} is invalid JSON: ${error.message}`)

    return null
  }
}

function withoutVersion(value) {
  const { version: _version, ...rest } = value

  return rest
}

function checkBumpIncrement(name, releaseType, current, next, errors) {
  if (next.major !== current.major) {
    errors.push(`${name} automated major bump ${current.raw} -> ${next.raw} is forbidden`)

    return
  }
  if (releaseType === 'minor') {
    if (next.minor !== current.minor + 1 || next.patch !== 0) {
      errors.push(
        `${name} minor plan does not increment exactly once: ${current.raw} -> ${next.raw}`,
      )
    }

    return
  }
  if (releaseType === 'patch') {
    if (next.minor !== current.minor || next.patch !== current.patch + 1) {
      errors.push(
        `${name} patch plan does not increment exactly once: ${current.raw} -> ${next.raw}`,
      )
    }

    return
  }
  errors.push(`${name} has unsupported automatic release type ${JSON.stringify(releaseType)}`)
}

function planComponentBump(name, component, errors) {
  if (!component || typeof component !== 'object') {
    errors.push(`${name} release plan is missing`)

    return null
  }
  if (component.action === 'none' || component.action === 'release-current') {
    return null
  }
  if (component.action !== 'bump') {
    errors.push(`${name} has unsupported release action ${JSON.stringify(component.action)}`)

    return null
  }

  const current = parseVersion(component.currentVersion, `${name} current version`, errors)
  const next = parseVersion(component.nextVersion, `${name} next version`, errors)

  if (!current || !next) return null

  checkBumpIncrement(name, component.releaseType, current, next, errors)

  return { current, next }
}

function expectedReleaseContract(expectedReleasePlan, errors) {
  if (!expectedReleasePlan || typeof expectedReleasePlan !== 'object') {
    errors.push('expected release plan is missing')

    return { components: {}, files: [], title: null }
  }

  const components = {}
  const files = []
  const titleParts = []

  for (const [name, config] of Object.entries(COMPONENTS)) {
    const bump = planComponentBump(name, expectedReleasePlan[name], errors)

    if (!bump) continue

    components[config.packageFile] = {
      currentVersion: bump.current.raw,
      nextVersion: bump.next.raw,
    }
    files.push(config.packageFile)
    titleParts.push(`${name} v${bump.next.raw}`)
  }

  if (titleParts.length === 0) {
    errors.push('expected release plan contains no automatic version bump')
  }

  return {
    components,
    files,
    title: titleParts.length > 0 ? `release: ${titleParts.join(' + ')}` : null,
  }
}

function validatePackageChanges(packageContents, expected, errors) {
  if (!packageContents || typeof packageContents !== 'object') {
    errors.push('package contents are missing')

    return
  }

  for (const [file, versions] of Object.entries(expected.components)) {
    const contents = packageContents[file]
    const base = parsePackageJson(contents?.base, `${file} base contents`, errors)
    const head = parsePackageJson(contents?.head, `${file} head contents`, errors)

    if (!base || !head) continue

    if (base.version !== versions.currentVersion) {
      errors.push(
        `${file} base version ${JSON.stringify(base.version)} does not match planned current version ${JSON.stringify(versions.currentVersion)}`,
      )
    }
    if (head.version !== versions.nextVersion) {
      errors.push(
        `${file} head version ${JSON.stringify(head.version)} does not match planned next version ${JSON.stringify(versions.nextVersion)}`,
      )
    }
    if (!isDeepStrictEqual(withoutVersion(base), withoutVersion(head))) {
      errors.push(`${file} changes fields other than the top-level version`)
    }
  }
}

function validateFileList(files, expected, errors) {
  if (files.length === 0) {
    errors.push('release PR has no changed files')
  }
  const unexpectedFiles = files.filter((file) => !ALLOWED_FILES.has(file))

  if (unexpectedFiles.length > 0) {
    errors.push(`unexpected files: ${unexpectedFiles.join(', ')}`)
  }
  const actualFiles = [...files].sort()
  const expectedFiles = [...expected.files].sort()

  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    errors.push(
      `release files do not match plan: expected ${expectedFiles.join(', ') || '(none)'}, got ${actualFiles.join(', ') || '(none)'}`,
    )
  }
}

export function validateDailyReleasePullRequest(
  pullRequest,
  { expectedHeadSha, expectedReleasePlan, headParentIsMainAncestor, packageContents },
) {
  const errors = []
  const author = pullRequest.author?.login
  const files = pullRequest.files?.map((file) => file.path) ?? []
  const expected = expectedReleaseContract(expectedReleasePlan, errors)

  if (!ALLOWED_AUTHORS.has(author)) {
    errors.push(`unexpected author ${JSON.stringify(author)}`)
  }
  if (pullRequest.baseRefName !== 'main') {
    errors.push(`unexpected base ${JSON.stringify(pullRequest.baseRefName)}`)
  }
  if (pullRequest.headRefName !== 'automation/daily-release') {
    errors.push(`unexpected head ${JSON.stringify(pullRequest.headRefName)}`)
  }
  if (pullRequest.state !== 'OPEN') {
    errors.push(`unexpected state ${JSON.stringify(pullRequest.state)}`)
  }
  if (pullRequest.headRefOid !== expectedHeadSha) {
    errors.push(
      `head changed from ${JSON.stringify(expectedHeadSha)} to ${JSON.stringify(pullRequest.headRefOid)}`,
    )
  }
  if (headParentIsMainAncestor !== true) {
    errors.push('release commit parent is not an ancestor of main')
  }
  if (pullRequest.title !== expected.title) {
    errors.push(
      `unexpected title ${JSON.stringify(pullRequest.title)}; expected ${JSON.stringify(expected.title)}`,
    )
  }
  validateFileList(files, expected, errors)
  validatePackageChanges(packageContents, expected, errors)

  if (errors.length > 0) {
    throw new Error(
      `Refusing to bypass review for an untrusted release PR:\n- ${errors.join('\n- ')}`,
    )
  }

  return {
    author,
    files,
    headSha: pullRequest.headRefOid,
    title: pullRequest.title,
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const parentSha = releaseCommitParent(input.headRefOid)
  const result = validateDailyReleasePullRequest(input, {
    expectedHeadSha: process.env.PR_HEAD_SHA,
    headParentIsMainAncestor: isAncestor(parentSha, 'origin/main'),
    packageContents: packageContentsAt(parentSha, input.headRefOid, ALLOWED_FILES),
    expectedReleasePlan: Object.fromEntries(
      Object.keys(COMPONENTS).map((name) => {
        const prefix = name.toUpperCase()

        return [
          name,
          {
            action: process.env[`${prefix}_ACTION`],
            currentVersion: process.env[`${prefix}_CURRENT_VERSION`],
            nextVersion: process.env[`${prefix}_NEXT_VERSION`],
            releaseType: process.env[`${prefix}_RELEASE_TYPE`],
          },
        ]
      }),
    ),
  })

  console.log(`Validated trusted daily release PR ${result.headSha}: ${result.files.join(', ')}`)
}
