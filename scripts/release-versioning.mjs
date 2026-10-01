export function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)

  if (!match) {
    throw new Error(`${label} must be a stable semantic version, got "${value}"`)
  }

  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

const BUMP_PRIORITY = {
  patch: 0,
  minor: 1,
}

export function bumpVersion(version, releaseType) {
  if (releaseType === 'minor') {
    return `${version.major}.${version.minor + 1}.0`
  }

  return `${version.major}.${version.minor}.${version.patch + 1}`
}

function releaseTypeForMessage(message) {
  const header = message.split('\n', 1)[0]

  // Major releases are deliberately manual. A breaking marker still keeps the
  // Conventional Commit's base type: feat! is minor; every other type is patch.
  if (/^feat(?:\([^)\r\n]+\))?!?:/i.test(header)) return 'minor'

  return 'patch'
}

export function highestReleaseType(messages) {
  return messages.reduce((highest, message) => {
    const candidate = releaseTypeForMessage(message)

    return BUMP_PRIORITY[candidate] > BUMP_PRIORITY[highest] ? candidate : highest
  }, 'patch')
}
