import { execFileSync } from 'node:child_process'

// Repository-derived facts a release PR is judged against: the release
// commit's ancestry and the versioned files on either side of it. Kept apart
// from the validator so that one stays pure — it decides, this reads.

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

export function releaseCommitParent(headSha) {
  const parts = git(['rev-list', '--parents', '-n', '1', headSha]).split(' ')

  if (parts.length !== 2) {
    throw new Error(
      `Release commit ${headSha} must have exactly one parent, got ${parts.length - 1}`,
    )
  }

  return parts[1]
}

export function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' })

    return true
  } catch {
    return false
  }
}

/** `files` is the caller's policy about which paths a release may touch. */
export function packageContentsAt(baseSha, headSha, files) {
  return Object.fromEntries(
    [...files].map((file) => [
      file,
      {
        base: git(['show', `${baseSha}:${file}`]),
        head: git(['show', `${headSha}:${file}`]),
      },
    ]),
  )
}
