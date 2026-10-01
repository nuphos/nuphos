import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { dateInTimeZone } from './release-schedule.mjs'
import { compareVersions, parseVersion } from './release-versioning.mjs'

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function headCommit(root) {
  return git(root, ['rev-parse', 'HEAD'])
}

export function readPackageVersion(root, packageFile, revision = null) {
  const contents = revision
    ? git(root, ['show', `${revision}:${packageFile}`])
    : readFileSync(resolve(root, packageFile), 'utf8')
  const parsed = JSON.parse(contents)

  return parseVersion(parsed.version, `${packageFile} version`)
}

export function listReleaseTags(root, prefix) {
  const tags = git(root, ['tag', '--list', `${prefix}*`])

  if (!tags) return []

  return tags
    .split('\n')
    .map((tag) => {
      const value = tag.slice(prefix.length)

      try {
        return { tag, version: parseVersion(value, `tag ${tag}`) }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((left, right) => compareVersions(right.version, left.version))
}

export function assertTagIsAncestor(root, tag) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', tag, 'HEAD'], {
      cwd: root,
      stdio: 'ignore',
    })
  } catch {
    throw new Error(`Latest release tag ${tag} is not an ancestor of HEAD`)
  }
}

export function changedFilesSince(root, revision, paths) {
  const output = revision
    ? git(root, ['diff', '--name-only', `${revision}..HEAD`, '--', ...paths])
    : git(root, ['ls-files', '--', ...paths])

  return output ? output.split('\n').filter(Boolean) : []
}

export function commitMessagesSince(root, revision, paths) {
  if (!revision) return []
  const output = git(root, ['log', '--format=%B%x00', `${revision}..HEAD`, '--', ...paths])

  return output
    ? output
        .split('\0')
        .map((message) => message.trim())
        .filter(Boolean)
    : []
}

export function findVersionCommit(root, packageFile, currentVersion) {
  const commits = git(root, ['log', '--format=%H', '--', packageFile])

  if (!commits) {
    throw new Error(`Cannot find a commit containing ${packageFile}`)
  }

  let introductionCommit = null

  for (const commit of commits.split('\n')) {
    let version

    try {
      version = readPackageVersion(root, packageFile, commit).raw
    } catch {
      continue
    }
    if (version === currentVersion) {
      introductionCommit = commit
      continue
    }
    if (introductionCommit) break
  }

  if (introductionCommit) return introductionCommit

  throw new Error(`Cannot find the commit that introduced ${packageFile} version ${currentVersion}`)
}

export function releaseDateForTag(root, tag, timeZone) {
  const committedAt = git(root, ['show', '-s', '--format=%cI', `${tag}^{commit}`])

  return dateInTimeZone(new Date(committedAt), timeZone)
}
